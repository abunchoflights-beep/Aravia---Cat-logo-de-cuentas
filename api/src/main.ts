import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApp } from './shared/infrastructure/configure-app.js';
import { parseEnv } from './shared/infrastructure/env.config.js';

async function bootstrap(): Promise<void> {
  // Parse before creating the app so a bad configuration fails before any port is opened.
  const env = parseEnv(process.env);
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: env.webOrigin });
  configureApp(app);
  await app.listen(env.port);
  new Logger('Bootstrap').log(`API escuchando en el puerto ${env.port}`);
}

await bootstrap();
