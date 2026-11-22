import { parseEnv } from './env.config.js';

describe('parseEnv', () => {
  it('applies defaults when variables are absent', () => {
    expect(parseEnv({})).toEqual({ port: 3000, webOrigin: 'http://localhost:5173' });
  });

  it('reads valid values', () => {
    expect(parseEnv({ PORT: '8080', WEB_ORIGIN: 'https://catalogo.example.com' })).toEqual({
      port: 8080,
      webOrigin: 'https://catalogo.example.com',
    });
  });

  it.each(['abc', '0', '70000', '30.5'])('fails fast on PORT="%s"', (port) => {
    expect(() => parseEnv({ PORT: port })).toThrow(/La variable PORT/);
  });

  it.each(['localhost:5173', 'ftp://x.com', 'http://localhost:5173/app', '*'])(
    'fails fast on WEB_ORIGIN="%s"',
    (origin) => {
      expect(() => parseEnv({ WEB_ORIGIN: origin })).toThrow(/La variable WEB_ORIGIN/);
    },
  );
});
