import { Injectable, type PipeTransform } from '@nestjs/common';
import { RequestValidationException } from '../../../../shared/infrastructure/request-validation.exception.js';
import { AccountCode } from '../../domain/account-code.vo.js';

/** Validates the `:codigo` route parameter, reporting failures as `VALIDACION_ENTRADA_FALLIDA`. */
@Injectable()
export class ParseAccountCodePipe implements PipeTransform<string, string> {
  /**
   * Checks that the parameter is a valid account code.
   *
   * @param value - Raw route parameter.
   * @returns The same value when valid.
   * @throws {RequestValidationException} When the value is not a valid account code.
   */
  transform(value: string): string {
    if (!AccountCode.isValid(value)) {
      throw new RequestValidationException([
        {
          campo: 'codigo',
          mensaje: 'El código debe tener solo dígitos y una longitud de 1, 2, 4 o 6.',
        },
      ]);
    }
    return value;
  }
}
