/**
 * Make DUST spendable for the deployment wallet: register its NIGHT UTxOs for DUST
 * generation. Nothing in this repository can be deployed until this has run once.
 *
 * A registration pays its own fee out of the DUST its guaranteed NIGHT UTxO has already
 * generated (`splitNightUtxosForDustRegistration`), so no second funded wallet and no
 * faucet DUST is needed — only NIGHT that has been sitting in the wallet for a while.
 *
 *   MODE=estimate (default)  sync, print the NIGHT UTxOs, the registration fee and the
 *                            projected DUST generation. Touches nothing on chain.
 *   MODE=register            additionally build, finalize and submit the registration.
 *
 * Env: MN_SEED (hex, required), MN_ENV/NET, MN_NODE_URL, MN_INDEXER_URL, MN_INDEXER_WS_URL,
 *      MN_PROOF_SERVER_URL, MODE, DUST_WAIT_MS.
 *
 * NOTE on signing (cost a failed submission on 2026-09-17, node error 1010 "Custom error:
 * 192" = `MalformedError::InputsSignaturesLengthMismatch`): the recipe returned by
 * `registerNightUtxosForDustGeneration` is ALREADY signed — the facade calls `signRecipe`
 * inside `createDustActionTransaction` with the `signDustRegistration` callback passed in.
 * Signing it a second time adds a second signature for the same input and the node rejects
 * the transaction as malformed. Go straight from the recipe to `finalizeRecipe`.
 */
import * as ledger from '@midnightntwrk/ledger-v9';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { WalletFacade } from '@midnightntwrk/wallet-sdk-facade';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { createKeystore, PublicKey, UnshieldedWallet } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { stagenet } from './profile.js';

const log = (event: string, fields: Record<string, unknown> = {}): void =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));

const json = (value: unknown): string =>
  JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? v.toString() : v));

const profile = stagenet();
const networkId = profile.networkId;
const mode = process.env.MODE ?? 'estimate';
const dustWaitMs = Number(process.env.DUST_WAIT_MS ?? '600000');

const seedHex = process.env.MN_SEED;
if (!seedHex) throw new Error('MN_SEED is required');

const hd = HDWallet.fromSeed(Buffer.from(seedHex, 'hex'));
if (hd.type !== 'seedOk') throw new Error('invalid wallet seed');
const derived = hd.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.Zswap, Roles.NightExternal, Roles.Dust])
  .deriveKeysAt(0);
hd.hdWallet.clear();
if (derived.type !== 'keysDerived') throw new Error('wallet key derivation failed');
const keys = derived.keys;

const shieldedSecretKeys = ledger.ZswapSecretKeys.fromSeed(keys[Roles.Zswap]);
const dustSecretKey = ledger.DustSecretKey.fromSeed(keys[Roles.Dust]);
const keystore = createKeystore({ kind: 'schnorr', secret: keys[Roles.NightExternal] }, networkId);

const wsRelayUrl = (url: string): string => {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.toString();
};

const configuration = {
  networkId,
  indexerClientConnection: { indexerHttpUrl: profile.indexer, indexerWsUrl: profile.indexerWS },
  provingServerUrl: new URL(profile.proofServer),
  relayURL: new URL(wsRelayUrl(profile.node)),
  costParameters: { feeBlocksMargin: Number(process.env.FEE_BLOCKS_MARGIN ?? '100') },
  txHistoryStorage: {
    gotPending: async () => undefined,
    gotFinalized: async () => undefined,
    gotRejected: async () => undefined,
    getAll: async () => [] as unknown[],
    get: async () => undefined,
    serialize: async () => '[]',
  },
};

log('start', { networkId, mode, indexer: profile.indexer, address: keystore.getBech32Address().asString() });

const wallet = await WalletFacade.init({
  configuration: configuration as never,
  shielded: (config: unknown) => ShieldedWallet(config as never).startWithSecretKeys(shieldedSecretKeys),
  unshielded: (config: unknown) => UnshieldedWallet(config as never).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
  dust: (config: unknown) =>
    DustWallet(config as never).startWithSecretKey(dustSecretKey, ledger.LedgerParameters.initialParameters().dust),
} as never);

try {
  const startedAt = Date.now();
  await wallet.start(shieldedSecretKeys, dustSecretKey);
  const state = await wallet.waitForSyncedState();
  log('synced', { ms: Date.now() - startedAt });

  const night = ledger.nativeToken().raw;
  const nightUtxos = state.unshielded.availableCoins.filter(
    (coin: { utxo: { type: string } }) => coin.utxo.type === night,
  );
  log('night', {
    utxos: nightUtxos.map(
      (coin: {
        utxo: { value: bigint; intentHash: string; outputNo: number };
        meta: { ctime: Date; registeredForDustGeneration: boolean };
      }) => ({
        value: coin.utxo.value.toString(),
        intentHash: coin.utxo.intentHash,
        outputNo: coin.utxo.outputNo,
        ctime: coin.meta.ctime.toISOString(),
        registered: coin.meta.registeredForDustGeneration,
      }),
    ),
  });
  log('dust', { balance: state.dust.balance(new Date()).toString() });

  if (nightUtxos.length === 0) throw new Error('no NIGHT UTxOs — fund the wallet first');
  if (nightUtxos.every((coin: { meta: { registeredForDustGeneration: boolean } }) => coin.meta.registeredForDustGeneration)) {
    log('already-registered', { note: 'every NIGHT UTxO already generates DUST; nothing to do' });
    process.exit(0);
  }

  const estimate = await wallet.estimateRegistration(nightUtxos);
  log('estimateRegistration', {
    fee: estimate.fee.toString(),
    generation: estimate.dustGenerationEstimations.map((d: Record<string, unknown>) => JSON.parse(json(d))),
  });

  if (mode !== 'register') {
    log('estimate-only', { note: 'MODE=register performs the registration' });
  } else {
    await wallet.waitForGeneratedDust(nightUtxos, estimate.fee, { timeoutMs: dustWaitMs });
    log('dust-available', { requiredAmount: estimate.fee.toString() });

    // Already signed inside the facade — do NOT call signRecipe again (see the header).
    const recipe = await wallet.registerNightUtxosForDustGeneration(
      nightUtxos,
      keystore.getPublicKey(),
      (data: Uint8Array) => keystore.signDataAsync(data),
    );
    log('recipe', { type: recipe.type });

    const finalized = await wallet.finalizeRecipe(recipe);
    log('finalized');
    // Advisory only. On a FIRST registration this check reports
    // "insufficient dust to cover registration fee allowance: 0 available" because the
    // NIGHT UTxO is not registered yet, so the state it is evaluated against has generated
    // nothing — the whole point of the transaction being built. The node is the authority.
    try {
      await wallet.validateTransaction(finalized, {
        flags: { enforceBalancing: true, verifySignatures: true, enforceLimits: true },
      });
      log('validated');
    } catch (error) {
      log('validate-warning', { cause: String((error as { cause?: unknown }).cause ?? error) });
    }

    const identifier = await wallet.submitTransaction(finalized);
    log('submitted', { identifier });

    // Wait for the registration to show up on the UTxO itself.
    const deadline = Date.now() + 300_000;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, 6_000));
      const next = await wallet.waitForSyncedState();
      const registered = next.unshielded.availableCoins.filter(
        (coin: { utxo: { type: string }; meta: { registeredForDustGeneration: boolean } }) =>
          coin.utxo.type === night && coin.meta.registeredForDustGeneration,
      );
      const balance = next.dust.balance(new Date());
      log('poll', { registeredUtxos: registered.length, dust: balance.toString() });
      if (registered.length > 0 && balance > 0n) {
        log('registered', { dust: balance.toString() });
        break;
      }
      if (Date.now() > deadline) throw new Error('registration did not confirm within 300 s');
    }
  }
} finally {
  await wallet.stop();
  shieldedSecretKeys.clear();
  dustSecretKey.clear();
}
process.exit(0);
