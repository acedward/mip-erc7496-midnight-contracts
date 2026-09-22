import * as __compactRuntime from '@midnight-ntwrk/compact-runtime';
__compactRuntime.checkRuntimeVersion('0.19.0');

const _descriptor_0 = new __compactRuntime.CompactTypeUnsignedInteger(65535n, 2);

const _descriptor_1 = new __compactRuntime.CompactTypeBytes(288);

const _descriptor_2 = new __compactRuntime.CompactTypeBytes(32);

const _descriptor_3 = new __compactRuntime.CompactTypeUnsignedInteger(255n, 1);

const _descriptor_4 = new __compactRuntime.CompactTypeBytes(189);

const _descriptor_5 = new __compactRuntime.CompactTypeUnsignedInteger(18446744073709551615n, 8);

const _descriptor_6 = __compactRuntime.CompactTypeBoolean;

class _Either_0 {
  alignment() {
    return _descriptor_6.alignment().concat(_descriptor_2.alignment().concat(_descriptor_2.alignment()));
  }
  fromValue(value_0) {
    return {
      is_left: _descriptor_6.fromValue(value_0),
      left: _descriptor_2.fromValue(value_0),
      right: _descriptor_2.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_6.toValue(value_0.is_left).concat(_descriptor_2.toValue(value_0.left).concat(_descriptor_2.toValue(value_0.right)));
  }
}

const _descriptor_7 = new _Either_0();

const _descriptor_8 = new __compactRuntime.CompactTypeUnsignedInteger(340282366920938463463374607431768211455n, 16);

class _ContractAddress_0 {
  alignment() {
    return _descriptor_2.alignment();
  }
  fromValue(value_0) {
    return {
      bytes: _descriptor_2.fromValue(value_0)
    }
  }
  toValue(value_0) {
    return _descriptor_2.toValue(value_0.bytes);
  }
}

const _descriptor_9 = new _ContractAddress_0();

const _descriptor_10 = new __compactRuntime.CompactTypeUnsignedInteger(4294967295n, 4);

export class Contract {
  witnesses;
  constructor(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract constructor: expected 1 argument, received ${args_0.length}`);
    }
    const witnesses_0 = args_0[0];
    if (typeof(witnesses_0) !== 'object') {
      throw new __compactRuntime.CompactError('first (witnesses) argument to Contract constructor is not an object');
    }
    this.witnesses = witnesses_0;
    this.circuits = {
      publishRaw: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`publishRaw: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const domainSep_0 = args_1[1];
        const kind_0 = args_1[2];
        const key_0 = args_1[3];
        const valType_0 = args_1[4];
        const valLen_0 = args_1[5];
        const value_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('publishRaw',
                                     'argument 1 (as invoked from Typescript)',
                                     'MetadataProbe.compact line 32 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(domainSep_0.buffer instanceof ArrayBuffer && domainSep_0.BYTES_PER_ELEMENT === 1 && domainSep_0.length === 32)) {
          __compactRuntime.typeError('publishRaw',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'MetadataProbe.compact line 32 char 1',
                                     'Bytes<32>',
                                     domainSep_0)
        }
        if (!(typeof(kind_0) === 'bigint' && kind_0 >= 0n && kind_0 <= 255n)) {
          __compactRuntime.typeError('publishRaw',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'MetadataProbe.compact line 32 char 1',
                                     'Uint<0..256>',
                                     kind_0)
        }
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('publishRaw',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'MetadataProbe.compact line 32 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        if (!(typeof(valType_0) === 'bigint' && valType_0 >= 0n && valType_0 <= 255n)) {
          __compactRuntime.typeError('publishRaw',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'MetadataProbe.compact line 32 char 1',
                                     'Uint<0..256>',
                                     valType_0)
        }
        if (!(typeof(valLen_0) === 'bigint' && valLen_0 >= 0n && valLen_0 <= 255n)) {
          __compactRuntime.typeError('publishRaw',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'MetadataProbe.compact line 32 char 1',
                                     'Uint<0..256>',
                                     valLen_0)
        }
        if (!(value_0.buffer instanceof ArrayBuffer && value_0.BYTES_PER_ELEMENT === 1 && value_0.length === 189)) {
          __compactRuntime.typeError('publishRaw',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'MetadataProbe.compact line 32 char 1',
                                     'Bytes<189>',
                                     value_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(domainSep_0).concat(_descriptor_3.toValue(kind_0).concat(_descriptor_2.toValue(key_0).concat(_descriptor_3.toValue(valType_0).concat(_descriptor_3.toValue(valLen_0).concat(_descriptor_4.toValue(value_0)))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._publishRaw_0(context,
                                                  partialProofData,
                                                  domainSep_0,
                                                  kind_0,
                                                  key_0,
                                                  valType_0,
                                                  valLen_0,
                                                  value_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      publishStandard: async (...args_1) => {
        if (args_1.length !== 8) {
          throw new __compactRuntime.CompactError(`publishStandard: expected 8 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const domainSep_0 = args_1[1];
        const kind_0 = args_1[2];
        const name__0 = args_1[3];
        const nameLen_0 = args_1[4];
        const symbol__0 = args_1[5];
        const symbolLen_0 = args_1[6];
        const decimals__0 = args_1[7];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 1 (as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(domainSep_0.buffer instanceof ArrayBuffer && domainSep_0.BYTES_PER_ELEMENT === 1 && domainSep_0.length === 32)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'Bytes<32>',
                                     domainSep_0)
        }
        if (!(typeof(kind_0) === 'bigint' && kind_0 >= 0n && kind_0 <= 255n)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'Uint<0..256>',
                                     kind_0)
        }
        if (!(name__0.buffer instanceof ArrayBuffer && name__0.BYTES_PER_ELEMENT === 1 && name__0.length === 32)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'Bytes<32>',
                                     name__0)
        }
        if (!(typeof(nameLen_0) === 'bigint' && nameLen_0 >= 0n && nameLen_0 <= 255n)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'Uint<0..256>',
                                     nameLen_0)
        }
        if (!(symbol__0.buffer instanceof ArrayBuffer && symbol__0.BYTES_PER_ELEMENT === 1 && symbol__0.length === 32)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'Bytes<32>',
                                     symbol__0)
        }
        if (!(typeof(symbolLen_0) === 'bigint' && symbolLen_0 >= 0n && symbolLen_0 <= 255n)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'Uint<0..256>',
                                     symbolLen_0)
        }
        if (!(typeof(decimals__0) === 'bigint' && decimals__0 >= 0n && decimals__0 <= 255n)) {
          __compactRuntime.typeError('publishStandard',
                                     'argument 7 (argument 8 as invoked from Typescript)',
                                     'MetadataProbe.compact line 50 char 1',
                                     'Uint<0..256>',
                                     decimals__0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(domainSep_0).concat(_descriptor_3.toValue(kind_0).concat(_descriptor_2.toValue(name__0).concat(_descriptor_3.toValue(nameLen_0).concat(_descriptor_2.toValue(symbol__0).concat(_descriptor_3.toValue(symbolLen_0).concat(_descriptor_3.toValue(decimals__0))))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment()))))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._publishStandard_0(context,
                                                       partialProofData,
                                                       domainSep_0,
                                                       kind_0,
                                                       name__0,
                                                       nameLen_0,
                                                       symbol__0,
                                                       symbolLen_0,
                                                       decimals__0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      publishFixture: async (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`publishFixture: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('publishFixture',
                                     'argument 1 (as invoked from Typescript)',
                                     'MetadataProbe.compact line 69 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._publishFixture_0(context, partialProofData);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      publishLegacyName: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`publishLegacyName: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const domainSep_0 = args_1[1];
        const kind_0 = args_1[2];
        const key_0 = args_1[3];
        const valType_0 = args_1[4];
        const valLen_0 = args_1[5];
        const value_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('publishLegacyName',
                                     'argument 1 (as invoked from Typescript)',
                                     'MetadataProbe.compact line 88 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(domainSep_0.buffer instanceof ArrayBuffer && domainSep_0.BYTES_PER_ELEMENT === 1 && domainSep_0.length === 32)) {
          __compactRuntime.typeError('publishLegacyName',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'MetadataProbe.compact line 88 char 1',
                                     'Bytes<32>',
                                     domainSep_0)
        }
        if (!(typeof(kind_0) === 'bigint' && kind_0 >= 0n && kind_0 <= 255n)) {
          __compactRuntime.typeError('publishLegacyName',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'MetadataProbe.compact line 88 char 1',
                                     'Uint<0..256>',
                                     kind_0)
        }
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('publishLegacyName',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'MetadataProbe.compact line 88 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        if (!(typeof(valType_0) === 'bigint' && valType_0 >= 0n && valType_0 <= 255n)) {
          __compactRuntime.typeError('publishLegacyName',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'MetadataProbe.compact line 88 char 1',
                                     'Uint<0..256>',
                                     valType_0)
        }
        if (!(typeof(valLen_0) === 'bigint' && valLen_0 >= 0n && valLen_0 <= 255n)) {
          __compactRuntime.typeError('publishLegacyName',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'MetadataProbe.compact line 88 char 1',
                                     'Uint<0..256>',
                                     valLen_0)
        }
        if (!(value_0.buffer instanceof ArrayBuffer && value_0.BYTES_PER_ELEMENT === 1 && value_0.length === 189)) {
          __compactRuntime.typeError('publishLegacyName',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'MetadataProbe.compact line 88 char 1',
                                     'Bytes<189>',
                                     value_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(domainSep_0).concat(_descriptor_3.toValue(kind_0).concat(_descriptor_2.toValue(key_0).concat(_descriptor_3.toValue(valType_0).concat(_descriptor_3.toValue(valLen_0).concat(_descriptor_4.toValue(value_0)))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._publishLegacyName_0(context,
                                                         partialProofData,
                                                         domainSep_0,
                                                         kind_0,
                                                         key_0,
                                                         valType_0,
                                                         valLen_0,
                                                         value_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      publishPreMipName: async (...args_1) => {
        if (args_1.length !== 7) {
          throw new __compactRuntime.CompactError(`publishPreMipName: expected 7 arguments (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        const domainSep_0 = args_1[1];
        const kind_0 = args_1[2];
        const key_0 = args_1[3];
        const valType_0 = args_1[4];
        const valLen_0 = args_1[5];
        const value_0 = args_1[6];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('publishPreMipName',
                                     'argument 1 (as invoked from Typescript)',
                                     'MetadataProbe.compact line 115 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        if (!(domainSep_0.buffer instanceof ArrayBuffer && domainSep_0.BYTES_PER_ELEMENT === 1 && domainSep_0.length === 32)) {
          __compactRuntime.typeError('publishPreMipName',
                                     'argument 1 (argument 2 as invoked from Typescript)',
                                     'MetadataProbe.compact line 115 char 1',
                                     'Bytes<32>',
                                     domainSep_0)
        }
        if (!(typeof(kind_0) === 'bigint' && kind_0 >= 0n && kind_0 <= 255n)) {
          __compactRuntime.typeError('publishPreMipName',
                                     'argument 2 (argument 3 as invoked from Typescript)',
                                     'MetadataProbe.compact line 115 char 1',
                                     'Uint<0..256>',
                                     kind_0)
        }
        if (!(key_0.buffer instanceof ArrayBuffer && key_0.BYTES_PER_ELEMENT === 1 && key_0.length === 32)) {
          __compactRuntime.typeError('publishPreMipName',
                                     'argument 3 (argument 4 as invoked from Typescript)',
                                     'MetadataProbe.compact line 115 char 1',
                                     'Bytes<32>',
                                     key_0)
        }
        if (!(typeof(valType_0) === 'bigint' && valType_0 >= 0n && valType_0 <= 255n)) {
          __compactRuntime.typeError('publishPreMipName',
                                     'argument 4 (argument 5 as invoked from Typescript)',
                                     'MetadataProbe.compact line 115 char 1',
                                     'Uint<0..256>',
                                     valType_0)
        }
        if (!(typeof(valLen_0) === 'bigint' && valLen_0 >= 0n && valLen_0 <= 255n)) {
          __compactRuntime.typeError('publishPreMipName',
                                     'argument 5 (argument 6 as invoked from Typescript)',
                                     'MetadataProbe.compact line 115 char 1',
                                     'Uint<0..256>',
                                     valLen_0)
        }
        if (!(value_0.buffer instanceof ArrayBuffer && value_0.BYTES_PER_ELEMENT === 1 && value_0.length === 189)) {
          __compactRuntime.typeError('publishPreMipName',
                                     'argument 6 (argument 7 as invoked from Typescript)',
                                     'MetadataProbe.compact line 115 char 1',
                                     'Bytes<189>',
                                     value_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: {
            value: _descriptor_2.toValue(domainSep_0).concat(_descriptor_3.toValue(kind_0).concat(_descriptor_2.toValue(key_0).concat(_descriptor_3.toValue(valType_0).concat(_descriptor_3.toValue(valLen_0).concat(_descriptor_4.toValue(value_0)))))),
            alignment: _descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_2.alignment().concat(_descriptor_3.alignment().concat(_descriptor_3.alignment().concat(_descriptor_4.alignment())))))
          },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._publishPreMipName_0(context,
                                                         partialProofData,
                                                         domainSep_0,
                                                         kind_0,
                                                         key_0,
                                                         valType_0,
                                                         valLen_0,
                                                         value_0);
        partialProofData.output = { value: [], alignment: [] };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      },
      calls: async (...args_1) => {
        if (args_1.length !== 1) {
          throw new __compactRuntime.CompactError(`calls: expected 1 argument (as invoked from Typescript), received ${args_1.length}`);
        }
        const contextOrig_0 = args_1[0];
        if (!(typeof(contextOrig_0) === 'object' && contextOrig_0.callContext.currentQueryContext != undefined)) {
          __compactRuntime.typeError('calls',
                                     'argument 1 (as invoked from Typescript)',
                                     'MetadataProbe.compact line 132 char 1',
                                     'CircuitContext',
                                     contextOrig_0)
        }
        const context = __compactRuntime.copyCircuitContext(contextOrig_0);
        const partialProofData = {
          input: { value: [], alignment: [] },
          output: undefined,
          publicTranscript: [],
          privateTranscriptOutputs: []
        };
        const result_0 = await this._calls_0(context, partialProofData);
        partialProofData.output = { value: _descriptor_5.toValue(result_0), alignment: _descriptor_5.alignment() };
        __compactRuntime.finalizeCallProofData(context, partialProofData);
        return { result: result_0, context: context, gasCost: context.callContext.currentGasCost };
      }
    };
    this.impureCircuits = {
      publishRaw: this.circuits.publishRaw,
      publishStandard: this.circuits.publishStandard,
      publishFixture: this.circuits.publishFixture,
      publishLegacyName: this.circuits.publishLegacyName,
      publishPreMipName: this.circuits.publishPreMipName,
      calls: this.circuits.calls
    };
    this.provableCircuits = {
      publishRaw: this.circuits.publishRaw,
      publishStandard: this.circuits.publishStandard,
      publishFixture: this.circuits.publishFixture,
      publishLegacyName: this.circuits.publishLegacyName,
      publishPreMipName: this.circuits.publishPreMipName,
      calls: this.circuits.calls
    };
  }
  async initialState(...args_0) {
    if (args_0.length !== 1) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 1 argument (as invoked from Typescript), received ${args_0.length}`);
    }
    const constructorContext_0 = args_0[0];
    if (typeof(constructorContext_0) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'constructorContext' in argument 1 (as invoked from Typescript) to be an object`);
    }
    if (!('initialZswapLocalState' in constructorContext_0)) {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript)`);
    }
    if (typeof(constructorContext_0.initialZswapLocalState) !== 'object') {
      throw new __compactRuntime.CompactError(`Contract state constructor: expected 'initialZswapLocalState' in argument 1 (as invoked from Typescript) to be an object`);
    }
    const state_0 = new __compactRuntime.ContractState();
    let stateValue_0 = __compactRuntime.StateValue.newArray();
    stateValue_0 = stateValue_0.arrayPush(__compactRuntime.StateValue.newNull());
    state_0.data = new __compactRuntime.ChargedState(stateValue_0);
    state_0.setOperation('publishRaw', new __compactRuntime.ContractOperation());
    state_0.setOperation('publishStandard', new __compactRuntime.ContractOperation());
    state_0.setOperation('publishFixture', new __compactRuntime.ContractOperation());
    state_0.setOperation('publishLegacyName', new __compactRuntime.ContractOperation());
    state_0.setOperation('publishPreMipName', new __compactRuntime.ContractOperation());
    state_0.setOperation('calls', new __compactRuntime.ContractOperation());
    const context = __compactRuntime.createCircuitContext('constructor', __compactRuntime.dummyContractAddress(), constructorContext_0.initialZswapLocalState.coinPublicKey, state_0.data, constructorContext_0.initialPrivateState);
    const partialProofData = {
      input: { value: [], alignment: [] },
      output: undefined,
      publicTranscript: [],
      privateTranscriptOutputs: []
    };
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(0n),
                                                                                              alignment: _descriptor_3.alignment() }).encode() } },
                                       { push: { storage: true,
                                                 value: __compactRuntime.StateValue.newCell({ value: _descriptor_5.toValue(0n),
                                                                                              alignment: _descriptor_5.alignment() }).encode() } },
                                       { ins: { cached: false, n: 1 } }]);
    state_0.data = new __compactRuntime.ChargedState(context.callContext.currentQueryContext.state.state);
    return {
      currentContractState: state_0,
      currentPrivateState: context.callContext.currentPrivateState,
      currentZswapLocalState: context.callContext.currentZswapLocalState
    }
  }
  _EVENT_NAME_0() {
    return new Uint8Array([109, 105, 112, 45, 48, 48, 49, 56, 58, 116, 111, 107, 101, 110, 45, 109, 101, 116, 97, 100, 97, 116, 97, 91, 118, 49, 93, 0, 0, 0, 0, 0]);
  }
  _KIND_SHIELDED_0() { return 1n; }
  _VAL_TYPE_STRING_0() { return 1n; }
  _VAL_TYPE_INTEGER_0() { return 2n; }
  async _emitTokenMetadata_0(context,
                             partialProofData,
                             domainSep_0,
                             kind_0,
                             key_0,
                             valType_0,
                             valLen_0,
                             value_0)
  {
    let t_0;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newArray()
                                                          .arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(1n),
                                                                                                           alignment: _descriptor_10.alignment() })).arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(10n),
                                                                                                                                                                                                     alignment: _descriptor_3.alignment() })).arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue((t_0 = { name:
                                                                                                                                                                                                                                                                                                                                      this._EVENT_NAME_0(),
                                                                                                                                                                                                                                                                                                                                    payload:
                                                                                                                                                                                                                                                                                                                                      Uint8Array.from([...Array.from(domainSep_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt),
                                                                                                                                                                                                                                                                                                                                                       kind_0,
                                                                                                                                                                                                                                                                                                                                                       ...Array.from(key_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt),
                                                                                                                                                                                                                                                                                                                                                       valType_0,
                                                                                                                                                                                                                                                                                                                                                       valLen_0,
                                                                                                                                                                                                                                                                                                                                                       ...Array.from(value_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt)],
                                                                                                                                                                                                                                                                                                                                                      Number) },
                                                                                                                                                                                                                                                                                                                            Uint8Array.from([...Array.from(t_0.name,
                                                                                                                                                                                                                                                                                                                                                           BigInt),
                                                                                                                                                                                                                                                                                                                                             ...Array.from(t_0.payload,
                                                                                                                                                                                                                                                                                                                                                           BigInt)],
                                                                                                                                                                                                                                                                                                                                            Number))),
                                                                                                                                                                                                                                                                                              alignment: _descriptor_1.alignment() }))
                                                          .encode() } },
                                       'log']);
    return [];
  }
  async _emitStandardFields_0(context,
                              partialProofData,
                              domainSep_0,
                              kind_0,
                              name__0,
                              nameLen_0,
                              symbol__0,
                              symbolLen_0,
                              decimals__0)
  {
    await this._emitTokenMetadata_0(context,
                                    partialProofData,
                                    domainSep_0,
                                    kind_0,
                                    new Uint8Array([110, 97, 109, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                    this._VAL_TYPE_STRING_0(),
                                    nameLen_0,
                                    Uint8Array.from([...Array.from(name__0,
                                                                   BigInt),
                                                     ...Array.from(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                                                   BigInt)],
                                                    Number));
    await this._emitTokenMetadata_0(context,
                                    partialProofData,
                                    domainSep_0,
                                    kind_0,
                                    new Uint8Array([115, 121, 109, 98, 111, 108, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                    this._VAL_TYPE_STRING_0(),
                                    symbolLen_0,
                                    Uint8Array.from([...Array.from(symbol__0,
                                                                   BigInt),
                                                     ...Array.from(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                                                   BigInt)],
                                                    Number));
    await this._emitTokenMetadata_0(context,
                                    partialProofData,
                                    domainSep_0,
                                    kind_0,
                                    new Uint8Array([100, 101, 99, 105, 109, 97, 108, 115, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                    this._VAL_TYPE_INTEGER_0(),
                                    16n,
                                    Uint8Array.from([decimals__0,
                                                     ...Array.from(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                                                   BigInt)],
                                                    Number));
    return [];
  }
  async _publishRaw_0(context,
                      partialProofData,
                      domainSep_0,
                      kind_0,
                      key_0,
                      valType_0,
                      valLen_0,
                      value_0)
  {
    const tmp_0 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(0n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_0.toValue(tmp_0),
                                                                alignment: _descriptor_0.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    await this._emitTokenMetadata_0(context,
                                    partialProofData,
                                    domainSep_0,
                                    kind_0,
                                    key_0,
                                    valType_0,
                                    valLen_0,
                                    value_0);
    return [];
  }
  async _publishStandard_0(context,
                           partialProofData,
                           domainSep_0,
                           kind_0,
                           name__0,
                           nameLen_0,
                           symbol__0,
                           symbolLen_0,
                           decimals__0)
  {
    const tmp_0 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(0n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_0.toValue(tmp_0),
                                                                alignment: _descriptor_0.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    await this._emitStandardFields_0(context,
                                     partialProofData,
                                     domainSep_0,
                                     kind_0,
                                     name__0,
                                     nameLen_0,
                                     symbol__0,
                                     symbolLen_0,
                                     decimals__0);
    return [];
  }
  async _publishFixture_0(context, partialProofData) {
    const tmp_0 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(0n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_0.toValue(tmp_0),
                                                                alignment: _descriptor_0.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    await this._emitStandardFields_0(context,
                                     partialProofData,
                                     new Uint8Array([117, 109, 98, 114, 97, 58, 112, 114, 111, 98, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                     this._KIND_SHIELDED_0(),
                                     new Uint8Array([85, 109, 98, 114, 97, 32, 80, 114, 111, 98, 101, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                     11n,
                                     new Uint8Array([85, 80, 82, 79, 66, 69, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                     6n,
                                     6n);
    return [];
  }
  async _publishLegacyName_0(context,
                             partialProofData,
                             domainSep_0,
                             kind_0,
                             key_0,
                             valType_0,
                             valLen_0,
                             value_0)
  {
    const tmp_0 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(0n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_0.toValue(tmp_0),
                                                                alignment: _descriptor_0.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    let t_0;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newArray()
                                                          .arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(1n),
                                                                                                           alignment: _descriptor_10.alignment() })).arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(10n),
                                                                                                                                                                                                     alignment: _descriptor_3.alignment() })).arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue((t_0 = { name:
                                                                                                                                                                                                                                                                                                                                      new Uint8Array([84, 111, 107, 101, 110, 77, 101, 116, 97, 100, 97, 116, 97, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
                                                                                                                                                                                                                                                                                                                                    payload:
                                                                                                                                                                                                                                                                                                                                      Uint8Array.from([...Array.from(domainSep_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt),
                                                                                                                                                                                                                                                                                                                                                       kind_0,
                                                                                                                                                                                                                                                                                                                                                       ...Array.from(key_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt),
                                                                                                                                                                                                                                                                                                                                                       valType_0,
                                                                                                                                                                                                                                                                                                                                                       valLen_0,
                                                                                                                                                                                                                                                                                                                                                       ...Array.from(value_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt)],
                                                                                                                                                                                                                                                                                                                                                      Number) },
                                                                                                                                                                                                                                                                                                                            Uint8Array.from([...Array.from(t_0.name,
                                                                                                                                                                                                                                                                                                                                                           BigInt),
                                                                                                                                                                                                                                                                                                                                             ...Array.from(t_0.payload,
                                                                                                                                                                                                                                                                                                                                                           BigInt)],
                                                                                                                                                                                                                                                                                                                                            Number))),
                                                                                                                                                                                                                                                                                              alignment: _descriptor_1.alignment() }))
                                                          .encode() } },
                                       'log']);
    return [];
  }
  async _publishPreMipName_0(context,
                             partialProofData,
                             domainSep_0,
                             kind_0,
                             key_0,
                             valType_0,
                             valLen_0,
                             value_0)
  {
    const tmp_0 = 1n;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { idx: { cached: false,
                                                pushPath: true,
                                                path: [
                                                       { tag: 'value',
                                                         value: { value: _descriptor_3.toValue(0n),
                                                                  alignment: _descriptor_3.alignment() } }] } },
                                       { addi: { immediate: parseInt(__compactRuntime.valueToBigInt(
                                                              { value: _descriptor_0.toValue(tmp_0),
                                                                alignment: _descriptor_0.alignment() }
                                                                .value
                                                            )) } },
                                       { ins: { cached: true, n: 1 } }]);
    let t_0;
    __compactRuntime.queryLedgerState(context,
                                      partialProofData,
                                      [
                                       { push: { storage: false,
                                                 value: __compactRuntime.StateValue.newArray()
                                                          .arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_10.toValue(1n),
                                                                                                           alignment: _descriptor_10.alignment() })).arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_3.toValue(10n),
                                                                                                                                                                                                     alignment: _descriptor_3.alignment() })).arrayPush(__compactRuntime.StateValue.newCell({ value: _descriptor_1.toValue((t_0 = { name:
                                                                                                                                                                                                                                                                                                                                      new Uint8Array([109, 105, 112, 45, 120, 120, 120, 120, 58, 116, 111, 107, 101, 110, 45, 109, 101, 116, 97, 100, 97, 116, 97, 91, 118, 49, 93, 0, 0, 0, 0, 0]),
                                                                                                                                                                                                                                                                                                                                    payload:
                                                                                                                                                                                                                                                                                                                                      Uint8Array.from([...Array.from(domainSep_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt),
                                                                                                                                                                                                                                                                                                                                                       kind_0,
                                                                                                                                                                                                                                                                                                                                                       ...Array.from(key_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt),
                                                                                                                                                                                                                                                                                                                                                       valType_0,
                                                                                                                                                                                                                                                                                                                                                       valLen_0,
                                                                                                                                                                                                                                                                                                                                                       ...Array.from(value_0,
                                                                                                                                                                                                                                                                                                                                                                     BigInt)],
                                                                                                                                                                                                                                                                                                                                                      Number) },
                                                                                                                                                                                                                                                                                                                            Uint8Array.from([...Array.from(t_0.name,
                                                                                                                                                                                                                                                                                                                                                           BigInt),
                                                                                                                                                                                                                                                                                                                                             ...Array.from(t_0.payload,
                                                                                                                                                                                                                                                                                                                                                           BigInt)],
                                                                                                                                                                                                                                                                                                                                            Number))),
                                                                                                                                                                                                                                                                                              alignment: _descriptor_1.alignment() }))
                                                          .encode() } },
                                       'log']);
    return [];
  }
  async _calls_0(context, partialProofData) {
    return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                     partialProofData,
                                                                     [
                                                                      { dup: { n: 0 } },
                                                                      { idx: { cached: false,
                                                                               pushPath: false,
                                                                               path: [
                                                                                      { tag: 'value',
                                                                                        value: { value: _descriptor_3.toValue(0n),
                                                                                                 alignment: _descriptor_3.alignment() } }] } },
                                                                      { popeq: { cached: true,
                                                                                 result: undefined } }]).value);
  }
}
export function ledger(stateOrChargedState) {
  const state = stateOrChargedState instanceof __compactRuntime.StateValue ? stateOrChargedState : stateOrChargedState.state;
  const chargedState = stateOrChargedState instanceof __compactRuntime.StateValue ? new __compactRuntime.ChargedState(stateOrChargedState) : stateOrChargedState;
  const context = {
    callContext: { currentQueryContext: new __compactRuntime.QueryContext(chargedState, __compactRuntime.dummyContractAddress()), currentGasCost: __compactRuntime.emptyRunningCost() },
    costModel: __compactRuntime.CostModel.initialCostModel()
  };
  const partialProofData = {
    input: { value: [], alignment: [] },
    output: undefined,
    publicTranscript: [],
    privateTranscriptOutputs: []
  };
  return {
    get _calls() {
      return _descriptor_5.fromValue(__compactRuntime.queryLedgerState(context,
                                                                       partialProofData,
                                                                       [
                                                                        { dup: { n: 0 } },
                                                                        { idx: { cached: false,
                                                                                 pushPath: false,
                                                                                 path: [
                                                                                        { tag: 'value',
                                                                                          value: { value: _descriptor_3.toValue(0n),
                                                                                                   alignment: _descriptor_3.alignment() } }] } },
                                                                        { popeq: { cached: true,
                                                                                   result: undefined } }]).value);
    }
  };
}
const _emptyContext = {
  callContext: { currentQueryContext: new __compactRuntime.QueryContext(new __compactRuntime.ContractState().data, __compactRuntime.dummyContractAddress()), currentGasCost: __compactRuntime.emptyRunningCost() }
};
const _dummyContract = new Contract({ });
export const pureCircuits = {};
export const contractReferenceLocations =
  { tag: 'publicLedgerArray', indices: { } };
export const expectedVk = {};

//# sourceMappingURL=index.js.map
