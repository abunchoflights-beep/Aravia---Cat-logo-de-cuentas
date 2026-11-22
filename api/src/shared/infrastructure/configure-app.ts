import type { INestApplication } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { createValidationPipe } from './validation.js';

/**
 * Applies the global HTTP concerns shared by the real server and the e2e tests.
 *
 * @param app - Nest application to configure.
 */
export function configureApp(app: INestApplication): void {
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter());
}
