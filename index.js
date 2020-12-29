const execSync = require("child_process").execSync;
const fs = require("fs");
const {
  ownerToString,
  relayToString,
  certToString,
  txInToString,
  txOutToString,
  signingKeysToString,
  witnessFilesToString,
} = require("./helper");

class CardanoJs {
  /**
   *
   * @param {JSON} options - {shelleyGenesisPath: optional, socketPath: optional, cliPath: optional, era:optional, network: optional, dir: optional}
   */

  constructor(options) {
    this.network = `--mainnet`;
    this.era = "";
    this.dir = ".";
    this.cliPath = "cardano-cli";

    options.shelleyGenesisPath &&
      (this.shelleyGenesis = JSON.parse(
        execSync(`cat ${options.shelleyGenesisPath}`).toString()
      ));

    options.socketPath &&
      execSync(`export CARDANO_NODE_SOCKET_PATH=${options.socketPath}`);
    options.era && (this.era = "--" + options.era + "-era");
    options.network && (this.network = "--" + options.network);
    options.dir && (this.dir = options.dir);
    options.cliPath && (this.cliPath = options.cliPath);

    execSync(`mkdir -p ${this.dir}/tmp`);
    this.queryProtcolParameters();
  }

  queryProtcolParameters() {
    execSync(`${this.cliPath} query protocol-parameters \
                            ${this.network} \
                            --cardano-mode \
                            --out-file ${this.dir}/tmp/protocolParams.json \
                            ${this.era}
                        `);
    this.protcolParametersPath = `${this.dir}/tmp/protocolParams.json`;
    return JSON.parse(execSync(`cat ${this.dir}/tmp/protocolParams.json`));
  }

  queryTip() {
    return JSON.parse(
      execSync(`${this.cliPath} query tip \
        ${this.network} \
        --cardano-mode
                        `).toString()
    );
  }

  /**
   *
   * @param {string} address - Staking address
   */
  queryStakeAddressInfo(address) {
    return JSON.parse(
      execSync(`${this.cliPath} query stake-address-info \
        ${this.network} \
        --address ${address} \
        ${this.era}
        `).toString()
    );
  }

  /**
   *
   * @param {string} address - Payment address
   */
  queryUtxo(address) {
    let utxosRaw = execSync(`${this.cliPath} query utxo \
            ${this.network} \
            --address ${address} \
            --cardano-mode \
            ${this.era}
            `).toString();

    let utxos = utxosRaw.split("\n");
    utxos.splice(0, 1);
    utxos.splice(0, 1);
    utxos.splice(utxos.length - 1, 1);
    let result = utxos.map((raw, index) => {
      let utxo = raw.replace(/\s+/g, " ").split(" ");
      return {
        txHash: utxo[0],
        txId: parseInt(utxo[1]),
        amount: parseInt(utxo[2]),
      };
    });

    return result;
  }

  /**
   *
   * @param {string} account - Name for the payment account keys
   */
  addressKeyGen(account) {
    execSync(`mkdir -p ${this.dir}/priv/wallet/${account}`);
    execSync(`${this.cliPath} address key-gen \
                        --verification-key-file ${this.dir}/priv/wallet/${account}/${account}.payment.vkey \
                        --signing-key-file ${this.dir}/priv/wallet/${account}/${account}.payment.skey
                    `);
  }

  /**
   *
   * @param {string} account - Name for the stake account keys
   */
  stakeAddressKeyGen(account) {
    execSync(`mkdir -p ${this.dir}/priv/wallet/${account}`);
    execSync(`${this.cliPath} stake-address key-gen \
                        --verification-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.vkey \
                        --signing-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.skey
                    `);
  }

  /**
   *
   * @param {string} account - Name for the account
   */
  stakeAddressBuild(account) {
    execSync(`${this.cliPath} stake-address build \
                        --staking-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.vkey \
                        --out-file ${this.dir}/priv/wallet/${account}/${account}.stake.addr \
                        ${this.network}
                    `);
    return `${this.dir}/priv/wallet/${account}/${account}.stake.addr`;
  }

  /**
   *
   * @param {string} account - Name for the account
   */
  addressBuild(account) {
    execSync(`${this.cliPath} address build \
                    --payment-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.payment.vkey \
                    --staking-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.vkey \
                    --out-file ${this.dir}/priv/wallet/${account}/${account}.payment.addr \
                    ${this.network}
                `);
    return `${this.dir}/priv/wallet/${account}/${account}.payment.addr`;
  }

  addressKeyHash(account) {
    return execSync(`${this.cliPath} address key-hash \
                        --payment-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.payment.vkey \
                    `)
      .toString()
      .replace(/\s+/g, " ");
  }

  addressInfo(address) {
    return execSync(`${this.cliPath} address info \
            --address ${address} \
            `)
      .toString()
      .replace(/\s+/g, " ");
  }

  /**
   *
   * @param {JSON} script
   */
  addressBuildScript(script) {
    fs.writeFileSync(`${this.dir}/tmp/script.json`, JSON.stringify(script));
    let scriptAddr = execSync(
      `${this.cliPath} address build-script --script-file ${this.dir}/tmp/script.json ${this.network}`
    )
      .toString()
      .replace(/\s+/g, " ");
    execSync(`rm ${this.dir}/tmp/script.json`);
    return scriptAddr;
  }

  /**
   *
   * @param {string} account - Name for the account
   */
  wallet(account) {
    const paymentAddr = fs
      .readFileSync(
        `${this.dir}/priv/wallet/${account}/${account}.payment.addr`
      )
      .toString();
    const stakingAddr = fs
      .readFileSync(`${this.dir}/priv/wallet/${account}/${account}.stake.addr`)
      .toString();

    const balance = this.queryUtxo(paymentAddr).reduce(
      (acc, curr) => acc + curr.amount,
      0
    );

    let reward = this.queryStakeAddressInfo(stakingAddr);
    reward = reward.find((delegation) => delegation.address == stakingAddr)
      ? reward.find((delegation) => delegation.address == stakingAddr)
          .rewardAccountBalance
      : "Staking key not registered";

    return {
      name: account,
      paymentAddr,
      stakingAddr,
      balance,
      reward,
      file: (fileName) => {
        try {
          fs.readFileSync(
            `${this.dir}/priv/wallet/${account}/${account}.${fileName}`
          );
          return `${this.dir}/priv/wallet/${account}/${account}.${fileName}`;
        } catch (err) {
          throw new Error(
            `File ${fileName} of Account ${account} doesn't exist`
          );
        }
      },
    };
  }

  pool(name) {
    return {
      name,
      file: (fileName) => {
        try {
          fs.readFileSync(`${this.dir}/priv/pool/${name}/${name}.${fileName}`);
          return `${this.dir}/priv/pool/${name}/${name}.${fileName}`;
        } catch (err) {
          throw new Error(`File ${fileName} of Pool ${name} doesn't exist`);
        }
      },
    };
  }

  stakeAddressRegistrationCertificate(account) {
    execSync(`${this.cliPath} stake-address registration-certificate \
                        --staking-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.vkey \
                        --out-file ${this.dir}/priv/wallet/${account}/${account}.stake.cert
                    `);
    return `${this.dir}/priv/wallet/${account}/${account}.stake.cert`;
  }

  stakeAddressDeregistrationCertificate(account) {
    execSync(`${this.cliPath} stake-address deregistration-certificate \
                        --staking-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.vkey \
                        --out-file ${this.dir}/priv/wallet/${account}/${account}.stake.cert
                    `);
    return `${this.dir}/priv/wallet/${account}/${account}.stake.cert`;
  }

  stakeAddressDelegationCertificate(account, poolId) {
    execSync(`${this.cliPath} stake-address delegation-certificate \
                        --staking-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.vkey \
                        --stake-pool-id ${poolId} \
                        --out-file ${this.dir}/priv/wallet/${account}/${account}.deleg.cert
                    `);
    return `${this.dir}/priv/wallet/${account}/${account}.deleg.cert`;
  }

  stakeAddressKeyHash(account) {
    return execSync(`${this.cliPath} stake-address key-hash \
                        --staking-verification-key-file ${this.dir}/priv/wallet/${account}/${account}.stake.vkey \
                    `)
      .toString()
      .replace(/\s+/g, " ");
  }

  /**
   *
   * @param {string} poolName - Pool name
   */
  nodeKeyGenKES(poolName) {
    execSync(`mkdir -p ${this.dir}/priv/pool/${poolName}`);
    execSync(`${this.cliPath} node key-gen-KES \
                        --verification-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.kes.vkey \
                        --signing-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.kes.skey
                    `);
  }

  nodeKeyGen(poolName) {
    execSync(`mkdir -p ${this.dir}/priv/pool/${poolName}`);
    execSync(`${this.cliPath} node key-gen \
                        --cold-verification-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.node.vkey \
                        --cold-signing-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.node.skey \
                        --operational-certificate-issue-counter ${this.dir}/priv/pool/${poolName}/${poolName}.node.counter 
                    `);
  }

  nodeIssueOpCert(poolName) {
    execSync(`${this.cliPath} node issue-op-cert \
                        --kes-verification-key-file ${
                          this.dir
                        }/priv/pool/${poolName}/${poolName}.kes.vkey \
                        --cold-signing-key-file ${
                          this.dir
                        }/priv/pool/${poolName}/${poolName}.node.skey \
                        --operational-certificate-issue-counter ${
                          this.dir
                        }/priv/pool/${poolName}/${poolName}.node.counter \
                        --kes-period ${this.KESPeriod()} \
                        --out-file ${
                          this.dir
                        }/priv/pool/${poolName}/${poolName}.node.cert 
                    `);
    return `${this.dir}/priv/pool/${poolName}/${poolName}.node.cert`;
  }

  nodeKeyGenVRF(poolName) {
    execSync(`mkdir -p ${this.dir}/priv/pool/${poolName}`);
    execSync(`${this.cliPath} node key-gen-VRF \
                        --verification-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.vrf.vkey \
                        --signing-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.vrf.skey
                    `);
  }

  stakePoolId(poolName) {
    return execSync(
      `${this.cliPath} stake-pool id --cold-verification-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.node.vkey`
    )
      .toString()
      .replace(/\s+/g, " ");
  }

  /**
   *
   * @param {string} metadata | original file content
   */
  stakePoolMetadataHash(metadata) {
    fs.writeFileSync(`${this.dir}/tmp/poolmeta.json`, metadata);
    let metaHash = execSync(
      `${this.cliPath} stake-pool metadata-hash --pool-metadata-file ${this.dir}/tmp/poolmeta.json`
    )
      .toString()
      .replace(/\s+/g, " ");
    execSync(`rm ${this.dir}/tmp/poolmeta.json`);
    return metaHash;
  }

  /**
   *
   * @param {string} poolName | Pool name
   * @param {JSON} options | {pledge: Int, cost: Int, margin: Float, url: String, metaHash: String, rewardAccount: String, owners: Array, relays: Array}
   */
  stakePoolRegistrationCertificate(poolName, options) {
    if (
      !(
        options &&
        options.pledge &&
        options.margin &&
        options.cost &&
        options.url &&
        options.metaHash &&
        options.rewardAccount &&
        options.owners &&
        options.relays
      )
    )
      throw new Error("All options are required");
    let owners = ownerToString(options.owners);
    let relays = relayToString(options.relays);

    execSync(`${this.cliPath} stake-pool registration-certificate \
                --cold-verification-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.node.vkey \
                --vrf-verification-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.vrf.vkey \
                --pool-pledge ${options.pledge} \
                --pool-cost ${options.cost} \
                --pool-margin ${options.margin} \
                --pool-reward-account-verification-key-file ${options.rewardAccount} \
                ${owners} \
                ${relays} \
                ${this.network} \
                --metadata-url ${options.url} \
                --metadata-hash ${options.metaHash} \
                --out-file ${this.dir}/priv/pool/${poolName}/${poolName}.pool.cert
            `);
    return `${this.dir}/priv/pool/${poolName}/${poolName}.pool.cert`;
  }

  /**
   *
   * @param {string} poolName | Pool name
   * @param {number} epoch | Retirement Epoch
   */
  stakePoolDeregistrationCertificate(poolName, epoch) {
    execSync(`${this.cliPath} stake-pool deregistration-certificate \
                --cold-verification-key-file ${this.dir}/priv/pool/${poolName}/${poolName}.node.vkey \
                --epoch ${epoch}
                --out-file ${this.dir}/priv/pool/${poolName}/${poolName}.pool.dereg
              `);
    return `${this.dir}/priv/pool/${poolName}/${poolName}.pool.dereg`;
  }

  transactionBuildRaw(options) {
    if (!(options && options.txIn && options.txOut))
      throw new Error("TxIn and TxOut required");
    let UID = Math.random().toString(36).substr(2, 9);
    let certs = options.certs ? certToString(options.certs) : "";
    let withdrawal = options.withdrawal
      ? `--withdrawal ${options.withdrawal.stakingAddress}+${options.withdrawal.reward}`
      : "";
    let txIn = options.txIn;
    let txOut = options.txOut;
    let txInString = txInToString(txIn);
    let txOutString = txOutToString(txOut);
    execSync(`${this.cliPath} transaction build-raw \
                ${txInString} \
                ${txOutString} \
                ${certs} \
                ${withdrawal} \
                --invalid-hereafter ${this.queryTip().slotNo + 10000} \
                --fee ${options.fee ? options.fee : 0} \
                --out-file ${this.dir}/tmp/tx_${UID}.raw \
                ${this.era}`);

    return `${this.dir}/tmp/tx_${UID}.raw`;
  }

  transactionCalculateMinFee(options) {
    return parseInt(
      execSync(`${this.cliPath} transaction calculate-min-fee \
                --tx-body-file ${options.txBody} \
                --tx-in-count ${options.txIn.length} \
                --tx-out-count ${options.txOut.length} \
                --mainnet \
                --witness-count ${options.witnessCount} \
                --protocol-params-file ${this.protcolParametersPath}`)
        .toString()
        .replace(/\s+/g, " ")
        .split(" ")[0]
    );
  }

  transactionSign(options) {
    let UID = Math.random().toString(36).substr(2, 9);
    let signingKeys = signingKeysToString(options.signingKeys);
    let scriptFile = options.scriptFile
      ? `--script-file ${options.scriptFile}`
      : "";
    execSync(`${this.cliPath} transaction sign \
        --tx-body-file ${options.txBody} \
        ${scriptFile} \
        ${this.network} \
        ${signingKeys} \
        --out-file ${this.dir}/tmp/tx_${UID}.signed`);
    return `${this.dir}/tmp/tx_${UID}.signed`;
  }

  transactionWitness(options) {
    let UID = Math.random().toString(36).substr(2, 9);
    let scriptFile = options.scriptFile
      ? `--script-file ${options.scriptFile}`
      : "";
    execSync(`${this.cliPath} transaction witness \
        --tx-body-file ${options.txBody} \
        ${scriptFile} \
        ${this.network} \
        --signing-key-file ${options.signingKey} \
        --out-file ${this.dir}/tmp/tx_${UID}.witness`);
    return `${this.dir}/tmp/tx_${UID}.witness`;
  }

  transactionAssemble(options) {
    let UID = Math.random().toString(36).substr(2, 9);
    let witnessFiles = witnessFilesToString(options.witnessFiles);
    execSync(`${this.cliPath} transaction assemble \
        --tx-body-file ${options.txBody} \
        ${witnessFiles} \
        --out-file ${this.dir}/tmp/tx_${UID}.signed`);
    return `${this.dir}/tmp/tx_${UID}.signed`;
  }

  transactionSubmit(tx) {
    execSync(
      `${this.cliPath} transaction submit ${this.network} --tx-file ${tx}`
    );
    return this.transactionTxid({ txFile: tx });
  }

  /**
   *
   * @param {JSON} options {txBody: String, txFile: String}
   */
  transactionTxid(options) {
    let txArg = options.txBody
      ? `--tx-body-file ${options.txBody}`
      : `--tx-file ${options.txFile}`;
    return execSync(`${this.cliPath} transaction txid ${txArg}`)
      .toString()
      .replace(/\s+/g, " ");
  }

  KESPeriod() {
    if (!this.shelleyGenesis) throw new Error("shelleyGenesisPath required");
    return parseInt(
      this.queryTip().slotNo / this.shelleyGenesis.slotsPerKESPeriod
    );
  }

  toLovelace(ada) {
    return ada * 1000000;
  }

  toAda(lovelace) {
    return lovelace / 1000000;
  }
}

module.exports = CardanoJs;
