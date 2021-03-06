import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router, NavigationEnd } from '@angular/router';
import { Account } from '../../services/wallet/wallet';
import { WalletService } from '../../services/wallet/wallet.service';
import { TimeAgoPipe } from '../../pipes/time-ago.pipe';
import { TranslateService } from '@ngx-translate/core';
import { MessageService } from '../../services/message/message.service';
import * as copy from 'copy-to-clipboard';
import { filter } from 'rxjs/internal/operators/filter';
import { CoordinatorService } from '../../services/coordinator/coordinator.service';
import { Constants } from '../../constants';

@Component({
  selector: 'app-account-view',
  templateUrl: './account-view.component.html',
  styleUrls: ['./account-view.component.scss'],
})
export class AccountViewComponent implements OnInit {
  account: Account;
  CONSTANTS = new Constants();
  constructor(
    private route: ActivatedRoute,
    private walletService: WalletService,
    public translate: TranslateService,
    public messageService: MessageService,
    public timeAgoPipe: TimeAgoPipe,
    private router: Router,
    private coordinatorService: CoordinatorService
  ) {}
    trigger = true;
  ngOnInit(): void {
    if (!this.walletService.wallet) {
      this.router.navigate(['']);
    } else {
      this.coordinatorService.startAll();
      let address = this.route.snapshot.paramMap.get('address');
      if (this.walletService.addressExists(address)) {
        this.account = this.walletService.wallet.getAccount(address);
      }
      this.router.events
        .pipe(filter((evt) => evt instanceof NavigationEnd))
        .subscribe(() => {
          address = this.route.snapshot.paramMap.get('address');
          if (this.walletService.wallet && this.walletService.addressExists(address)) {
            this.account = this.walletService.wallet.getAccount(address);
          }
        });
        setInterval(() => this.trigger = !this.trigger, 10 * 1000);
    }
  }
  getType(transaction: any): string {
    if (transaction.type !== 'transaction') {
      if (transaction.type === 'delegation') {
        if (transaction.destination) {
          return 'delegated';
        } else {
          return 'undelegated';
        }
      } else {
        return transaction.type;
      }
    } else {
      let operationType = '';
      if (transaction.source === this.account.address) {
        operationType = 'sent';
      } else {
        operationType = 'received';
      }
      return operationType;
    }
  }

  getCounterparty(transaction: any): string {
    if (transaction.type === 'delegation') {
      if (transaction.destination) {
        return transaction.destination;
      } else {
        return ''; // User has undelegated
      }
    } else if (transaction.type === 'transaction') {
      if (this.account.address === transaction.source) {
        return transaction.destination; // to
      } else {
        return transaction.source; // from
      }
    } else if (transaction.type === 'origination') {
      if (this.account.address === transaction.source) {
        return transaction.destination;
      } else {
        return transaction.source;
      }
    }
    return '';
  }
  copy(account: Account) {
    copy(account.address);
    const copyToClipboard = this.translate.instant(
      'OVERVIEWCOMPONENT.COPIEDTOCLIPBOARD'
    );
    this.messageService.add(account.address + ' ' + copyToClipboard, 5);
  }
  explorerURL(hash: string) {
    const baseURL = this.CONSTANTS.NET.NETWORK === 'carthagenet' ? 'https://carthage.tzkt.io/' : 'https://tzkt.io/';
    return baseURL + hash;
  }
}

