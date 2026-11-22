import { Module } from '@nestjs/common';
import { CreateAccountUseCase } from '../application/create-account.use-case.js';
import { DeleteAccountUseCase } from '../application/delete-account.use-case.js';
import { ListAccountTreeUseCase } from '../application/list-account-tree.use-case.js';
import { ACCOUNT_REPOSITORY, type AccountRepository } from '../domain/account.repository.js';
import { AccountsController } from './http/accounts.controller.js';
import { InMemoryAccountRepository } from './persistence/in-memory-account.repository.js';
import { SEED_ACCOUNTS } from './persistence/seed-accounts.js';

/** Wires the "catálogo de cuentas" bounded context. Use cases stay free of Nest decorators. */
@Module({
  controllers: [AccountsController],
  providers: [
    {
      provide: ACCOUNT_REPOSITORY,
      useFactory: (): AccountRepository => new InMemoryAccountRepository(SEED_ACCOUNTS),
    },
    {
      provide: ListAccountTreeUseCase,
      useFactory: (accounts: AccountRepository): ListAccountTreeUseCase =>
        new ListAccountTreeUseCase(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: CreateAccountUseCase,
      useFactory: (accounts: AccountRepository): CreateAccountUseCase =>
        new CreateAccountUseCase(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
    {
      provide: DeleteAccountUseCase,
      useFactory: (accounts: AccountRepository): DeleteAccountUseCase =>
        new DeleteAccountUseCase(accounts),
      inject: [ACCOUNT_REPOSITORY],
    },
  ],
})
export class AccountsModule {}
