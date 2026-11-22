import { Transform } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { ACCOUNT_NATURES, type AccountNature } from '../../domain/account-nature.js';
import { ACCOUNT_NAME_MAX_LENGTH } from '../../domain/account.entity.js';

/** Codes of 1, 2, 4 or 6 digits (spec R2). */
const ACCOUNT_CODE_PATTERN = /^(\d|\d{2}|\d{4}|\d{6})$/;

/** Validated body of `POST /cuentas`. Field names are the public Spanish contract. */
export class CreateAccountRequest {
  @IsDefined({ message: 'El código es obligatorio.' })
  @IsString({ message: 'El código es obligatorio.' })
  @Matches(ACCOUNT_CODE_PATTERN, {
    message: 'El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.',
  })
  readonly codigo: string;

  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsDefined({ message: 'El nombre es obligatorio.' })
  @IsString({ message: 'El nombre es obligatorio.' })
  @IsNotEmpty({ message: 'El nombre es obligatorio.' })
  @MaxLength(ACCOUNT_NAME_MAX_LENGTH, {
    message: `El nombre no puede superar los ${ACCOUNT_NAME_MAX_LENGTH} caracteres.`,
  })
  readonly nombre: string;

  @IsOptional()
  @IsIn(Object.values(ACCOUNT_NATURES), { message: 'La naturaleza debe ser "debito" o "credito".' })
  readonly naturaleza?: AccountNature;
}
