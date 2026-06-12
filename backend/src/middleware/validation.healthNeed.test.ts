/**
 * healthNeed schema ↔ Prisma HealthNeedType parity — teardown finding #3.
 *
 * The create/listQuery schemas once hardcoded
 * ['CONDITION','ACTION','SERVICE','MEDICATION','LIFESTYLE'], so FOLLOW_UP
 * (a real Prisma value, offered in the UI) 422'd while MEDICATION/LIFESTYLE
 * passed Zod and died in Prisma as 500s. The schemas now derive from
 * z.nativeEnum(HealthNeedType); these tests make any future drift fail CI.
 */

import { describe, expect, it } from 'vitest';
import { HealthNeedType } from '../../generated/prisma/index.js';
import { schemas } from './validation.js';

function validCreatePayload(needType: string) {
  return {
    needType,
    name: 'Annual physical',
    description: 'Schedule a follow-up exam',
    urgency: 'ROUTINE',
  };
}

describe('schemas.healthNeed ↔ Prisma HealthNeedType parity', () => {
  it('create.needType accepts exactly the Prisma enum values', () => {
    const zodValues = Object.values(schemas.healthNeed.create.shape.needType.enum);
    expect(zodValues.sort()).toEqual(Object.values(HealthNeedType).sort());
  });

  it('listQuery.needType accepts exactly the Prisma enum values', () => {
    const zodValues = Object.values(
      schemas.healthNeed.listQuery.shape.needType.unwrap().enum
    );
    expect(zodValues.sort()).toEqual(Object.values(HealthNeedType).sort());
  });

  it.each(Object.values(HealthNeedType))(
    'create accepts Prisma value %s',
    (needType) => {
      const result = schemas.healthNeed.create.safeParse(validCreatePayload(needType));
      expect(result.success).toBe(true);
    }
  );

  it('create accepts FOLLOW_UP (UI value previously rejected with 422)', () => {
    const result = schemas.healthNeed.create.safeParse(validCreatePayload('FOLLOW_UP'));
    expect(result.success).toBe(true);
  });

  it.each(['MEDICATION', 'LIFESTYLE'])(
    'create rejects %s (previously passed Zod, then 500d in Prisma)',
    (needType) => {
      const result = schemas.healthNeed.create.safeParse(validCreatePayload(needType));
      expect(result.success).toBe(false);
    }
  );
});
