import { Injectable } from '@angular/core';
import { KeyPair, WalletType } from './../../interfaces';
import {
  WalletObject,
  HdWallet,
  FullWallet,
  LegacyWalletV1,
  LegacyWalletV2,
  LegacyWalletV3,
  ImplicitAccount,
  LedgerWallet,
  OriginatedAccount,
} from './wallet';
import { EncryptionService } from '../encryption/encryption.service';
import { OperationService } from '../operation/operation.service';
import { utils, hd } from '@tezos-core-tools/crypto-utils';
@Injectable()
export class WalletService {
  storeKey = `kukai-wallet`;
  storageId = 0;
  wallet: WalletObject;

  constructor(
    private encryptionService: EncryptionService,
    private operationService: OperationService
  ) {}
  /*
    Wallet creation
  */
  createNewWallet(): string {
    return utils.generateMnemonic(24);
  }
  async createEncryptedWallet(
    mnemonic: string,
    password: string,
    passphrase: string = '',
    hdSeed: boolean
  ): Promise<any> {
    const seed = utils.mnemonicToSeed(mnemonic, passphrase, hdSeed);
    const entropy: Buffer = Buffer.from(utils.mnemonicToEntropy(mnemonic));
    let keyPair: KeyPair;
    if (!hdSeed) {
      keyPair = this.operationService.seed2keyPair(seed);
    } else {
      keyPair = hd.keyPairFromAccountIndex(seed, 0);
    }
    const encrypted = await this.encryptionService.encrypt(seed, password, 3);
    const encryptedSeed: string = encrypted.chiphertext;
    const iv: string = encrypted.iv;
    const iv2: string = this.encryptionService.bumpIV(iv, 1);
    const encryptedEntropy: string = (await this.encryptionService.encrypt(
      entropy,
      password,
      3,
      iv2
    )).chiphertext;
    return {
      data: this.exportKeyStoreInit(
        hdSeed ? WalletType.HdWallet : WalletType.FullWallet,
        encryptedSeed,
        encryptedEntropy,
        iv
      ),
      pkh: keyPair.pkh,
      pk: keyPair.pk,
      seed: seed,
    };
  }
  async getKeys(pwd: string, pkh?: string): Promise<KeyPair> {
    let seed;
    if (this.wallet instanceof LegacyWalletV1) {
      console.log('v1');
      seed = await this.encryptionService.decrypt(
        this.wallet.encryptedSeed,
        pwd,
        this.wallet.salt,
        1
      );
      console.log('done');
    } else if (this.wallet instanceof LegacyWalletV2) {
      seed = await this.encryptionService.decrypt(
        this.wallet.encryptedSeed,
        pwd,
        this.wallet.IV,
        2
      );
    } else if (
      this.wallet instanceof LegacyWalletV3 ||
      this.wallet instanceof HdWallet
    ) {
      seed = await this.encryptionService.decrypt(
        this.wallet.encryptedSeed,
        pwd,
        this.wallet.IV,
        3
      );
    } else if (this.wallet instanceof LedgerWallet) {
      console.log(this.wallet);
      const keyPair: KeyPair = {
        sk: null,
        pk: this.wallet.implicitAccounts[0].pk,
        pkh: this.wallet.implicitAccounts[0].pkh,
      };
      return keyPair;
    } else {
      return null;
    }
    if (!seed) {
      return null;
    }
    if (this.wallet instanceof HdWallet) {
      if (!pkh) {
        throw new Error('No pkh provided');
      }
      const account = this.wallet.getImplicitAccount(pkh);
      if (!account.derivationPath) {
        throw new Error('No derivationPath found');
      }
      return hd.seedToKeyPair(seed, account.derivationPath);
    } else if (this.wallet instanceof LegacyWalletV1) {
      const keyPair = this.operationService.seed2keyPair(seed);
      if (!keyPair.pkh || !pkh || keyPair.pkh !== pkh) {
        return null;
      } else {
        return keyPair;
      }
    } else {
      return this.operationService.seed2keyPair(seed);
    }
  }
  async revealMnemonicPhrase(pwd: string): Promise<string> {
    if (
      this.wallet &&
      (this.wallet instanceof HdWallet || this.wallet instanceof LegacyWalletV3)
    ) {
      const iv = this.encryptionService.bumpIV(this.wallet.IV, 1);
      const entropy = await this.encryptionService.decrypt(
        this.wallet.encryptedEntropy,
        pwd,
        iv,
        3
      );
      if (entropy) {
        return utils.entropyToMnemonic(entropy);
      } else {
        console.log('Invalid password');
      }
    }
    return '';
  }
  addImplicitAccount(pk: string, derivationPath?: string | number) {
    const pkh = utils.pkToPkh(pk);
    this.wallet.implicitAccounts.push(
      new ImplicitAccount(pkh, pk, typeof derivationPath === 'number' ? `44'/1729'/${derivationPath}'/0'` : derivationPath)
    );
    console.log('Adding new implicit account...');
    console.log(
      this.wallet.implicitAccounts[this.wallet.implicitAccounts.length - 1]
    );
    this.storeWallet();
  }
  addOriginatedAccount(kt: string, manager: string) {
    const implicitAccount = this.wallet.getImplicitAccount(manager);
    if (implicitAccount) {
      const origAcc = new OriginatedAccount(
        kt,
        implicitAccount.pkh,
        implicitAccount.pk
      );
      implicitAccount.originatedAccounts.push(origAcc);
      this.storeWallet();
    } else {
      console.warn(`Manager address $(manager) not found`);
    }
  }
  /*addUnusedAccount(account: any) {
    if (this.wallet instanceof HdWallet) {
      this.wallet.unusedAccounts.push(account);
    }
  }*/
  addressExists(address: string): boolean {
    return (
      this.wallet.getAccounts().findIndex((a) => a.address === address) !== -1
    );
  }
  async incrementAccountIndex(password: string): Promise<string> {
    if (this.wallet instanceof HdWallet) {
      const seed = await this.encryptionService.decrypt(
        this.wallet.encryptedSeed,
        password,
        this.wallet.IV,
        3
      );
      if (seed) {
        const keyPair: KeyPair = hd.seedToKeyPair(seed, `44'/1729'/${this.wallet.index}'/0'`);
        this.addImplicitAccount(keyPair.pk, this.wallet.index);
        this.wallet.index++;
        this.storeWallet();
        return keyPair.pkh;
      } else {
        return ''; // Wrong pwd
      }
    }
  }
  /*
    Clear wallet data from browser
  */
  clearWallet() {
    this.wallet = null;
    this.storageId = 0;
    localStorage.removeItem(this.storeKey);
  }
  /*
  Used to decide wallet type
  */
  isFullWallet(): boolean {
    return this.wallet instanceof FullWallet;
  }
  isViewOnlyWallet(): boolean {
    return false;
  }
  isObserverWallet(): boolean {
    return false;
  }
  isLedgerWallet(): boolean {
    return this.wallet instanceof LedgerWallet;
  }
  isHdWallet(): boolean {
    return this.wallet instanceof HdWallet;
  }
  exportKeyStoreInit(
    type: WalletType,
    encryptedSeed: string,
    encryptedEntropy: string,
    iv: string
  ) {
    const data: any = {
      provider: 'Kukai',
      version: 3.0,
      walletType: type,
      encryptedSeed,
      encryptedEntropy,
      iv,
    };
    return data;
  }
  /*
    Read and write to localStorage
  */
  initStorage() {
    this.storageId = Date.now();
    localStorage.setItem(
      this.storeKey,
      JSON.stringify({ localStorageId: this.storageId })
    );
  }
  storeWallet() {
    const localStorageId = this.getLocalStorageId();
    if (this.storageId && localStorageId && this.storageId === localStorageId) {
      let type = 'unknown';
      if (this.wallet instanceof HdWallet) {
        type = 'HdWallet';
      } else if (this.wallet instanceof LegacyWalletV1) {
        type = 'LegacyWalletV1';
      } else if (this.wallet instanceof LegacyWalletV2) {
        type = 'LegacyWalletV2';
      } else if (this.wallet instanceof LegacyWalletV3) {
        type = 'LegacyWalletV3';
      } else if (this.wallet instanceof LedgerWallet) {
        type = 'LedgerWallet';
      }
      console.log('Type is ' + type);
      localStorage.setItem(
        this.storeKey,
        JSON.stringify({ type, localStorageId: this.storageId, data: this.wallet })
      );
    } else {
      console.log('Outdated storage id');
    }
  }
  getLocalStorageId() {
    const walletData = localStorage.getItem(this.storeKey);
    if (walletData) {
      const parsed = JSON.parse(walletData);
      if (parsed && parsed.localStorageId) {
        return parsed.localStorageId;
      }
    }
    return 0;
  }

  loadStoredWallet() {
    const walletData = localStorage.getItem(this.storeKey);
    console.log(walletData);
    if (walletData && walletData !== 'undefined') {
      const parsedWalletData = JSON.parse(walletData);
      if (parsedWalletData.type && parsedWalletData.data && parsedWalletData.localStorageId) {
        this.storageId = parsedWalletData.localStorageId;
        const wd = parsedWalletData.data;
        this.deserializeStoredWallet(wd, parsedWalletData.type);
        console.log(this.wallet);
      } else {
        console.log('couldnt load a wallet');
        this.clearWallet();
      }
    } else {
      console.log('couldnt load a wallet');
      this.clearWallet();
    }
  }
  deserializeStoredWallet(wd: any, type: string) {
    switch (type) {
      case 'HdWallet':
        this.wallet = new HdWallet(
          wd.IV,
          wd.encryptedSeed,
          wd.encryptedEntropy
        );
        if (this.wallet instanceof HdWallet) {
          this.wallet.index = wd.index;
        }
        break;
      case 'LegacyWalletV1':
        this.wallet = new LegacyWalletV1(wd.salt, wd.encryptedSeed);
        break;
      case 'LegacyWalletV2':
        this.wallet = new LegacyWalletV2(wd.IV, wd.encryptedSeed);
        break;
      case 'LegacyWalletV3':
        this.wallet = new LegacyWalletV3(
          wd.IV,
          wd.encryptedSeed,
          wd.encryptedEntropy
        );
        break;
      case 'LedgerWallet':
        this.wallet = new LedgerWallet();
        break;
      default:
    }
    this.wallet.XTZrate = wd.XTZrate;
    this.wallet.totalBalanceUSD = wd.totalBalanceUSD;
    this.wallet.totalBalanceXTZ = wd.totalBalanceXTZ;
    for (const implicit of wd.implicitAccounts) {
      const impAcc: ImplicitAccount = new ImplicitAccount(
        implicit.pkh,
        implicit.pk,
        implicit.derivationPath ? implicit.derivationPath : null
      );
      impAcc.balanceUSD = implicit.balanceUSD;
      impAcc.balanceXTZ = implicit.balanceXTZ;
      impAcc.delegate = implicit.delegate;
      impAcc.activitiesCounter = implicit.activitiesCounter;
      impAcc.activities = implicit.activities;
      for (const originated of implicit.originatedAccounts) {
        const origAcc = new OriginatedAccount(
          originated.address,
          impAcc.pkh,
          impAcc.pk
        );
        origAcc.balanceUSD = originated.balanceUSD;
        origAcc.balanceXTZ = originated.balanceXTZ;
        origAcc.delegate = originated.delegate;
        origAcc.activitiesCounter = originated.activitiesCounter;
        origAcc.activities = originated.activities;
        impAcc.originatedAccounts.push(origAcc);
      }
      this.wallet.implicitAccounts.push(impAcc);
    }
  }
}
