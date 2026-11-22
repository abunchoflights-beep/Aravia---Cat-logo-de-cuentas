import { Module } from '@nestjs/common';
import { AccountsModule } from './modules/accounts/infrastructure/accounts.module.js';

/** Root module: composes the bounded contexts of the API. */
@Module({
  imports: [AccountsModule],
})
export class AppModule {}
