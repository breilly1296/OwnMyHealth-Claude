import type { SignOptions, VerifyOptions } from 'jsonwebtoken';

export const JWT_SIGN_OPTIONS: SignOptions = {
  algorithm: 'HS256',
  issuer: 'ownmyhealth-api',
  audience: 'ownmyhealth-web',
};

export const JWT_VERIFY_OPTIONS: VerifyOptions = {
  algorithms: ['HS256'],
  issuer: 'ownmyhealth-api',
  audience: 'ownmyhealth-web',
};
