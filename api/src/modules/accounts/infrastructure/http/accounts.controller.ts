import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import { CreateAccountUseCase } from '../../application/create-account.use-case.js';
import { DeleteAccountUseCase } from '../../application/delete-account.use-case.js';
import { ListAccountTreeUseCase } from '../../application/list-account-tree.use-case.js';
import { toAccountNodeResponse, type AccountNodeResponse } from './account.response.js';
import { CreateAccountRequest } from './create-account.request.js';
import { ParseAccountCodePipe } from './parse-account-code.pipe.js';

/** HTTP adapter for the chart of accounts (`/cuentas`). */
@Controller('cuentas')
export class AccountsController {
  /**
   * Creates the controller.
   *
   * @param listTree - Lists the catalog as a tree.
   * @param createAccount - Creates one account.
   * @param deleteAccount - Deletes one leaf account.
   */
  constructor(
    @Inject(ListAccountTreeUseCase) private readonly listTree: ListAccountTreeUseCase,
    @Inject(CreateAccountUseCase) private readonly createAccount: CreateAccountUseCase,
    @Inject(DeleteAccountUseCase) private readonly deleteAccount: DeleteAccountUseCase,
  ) {}

  /**
   * Returns the whole catalog as a tree.
   *
   * @returns Root nodes (classes) with nested children.
   */
  @Get()
  async list(): Promise<AccountNodeResponse[]> {
    const tree = await this.listTree.execute();
    return tree.map(toAccountNodeResponse);
  }

  /**
   * Creates an account.
   *
   * @param body - Validated request body.
   * @returns The created account.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateAccountRequest): Promise<AccountNodeResponse> {
    const created = await this.createAccount.execute({
      code: body.codigo,
      name: body.nombre,
      nature: body.naturaleza,
    });
    return toAccountNodeResponse(created);
  }

  /**
   * Deletes a leaf account.
   *
   * @param code - Validated account code from the path.
   */
  @Delete(':codigo')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('codigo', ParseAccountCodePipe) code: string): Promise<void> {
    await this.deleteAccount.execute(code);
  }
}
