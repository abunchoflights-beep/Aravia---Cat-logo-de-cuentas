import type { AccountRecord } from './account.mapper.js';

/** Sample catalog loaded on startup so the UI is usable on first run (spec §3.3). */
export const SEED_ACCOUNTS: ReadonlyArray<AccountRecord> = [
  { codigo: '1', nombre: 'Activo', naturaleza: 'debito' },
  { codigo: '11', nombre: 'Disponible', naturaleza: 'debito' },
  { codigo: '1105', nombre: 'Caja', naturaleza: 'debito' },
  { codigo: '110505', nombre: 'Caja general', naturaleza: 'debito' },
  { codigo: '110510', nombre: 'Caja menor', naturaleza: 'debito' },
  { codigo: '2', nombre: 'Pasivo', naturaleza: 'credito' },
  { codigo: '21', nombre: 'Obligaciones financieras', naturaleza: 'credito' },
  { codigo: '2105', nombre: 'Bancos nacionales', naturaleza: 'credito' },
];
