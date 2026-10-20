import { BadRequestException } from '@nestjs/common';

export class UnresolvedLocationException extends BadRequestException {
  override readonly name = 'UnresolvedLocationException';
  readonly code = 'UnresolvedLocationException';

  constructor(locationId: string) {
    super(`No existe dealer activo ni alias para la Location ID ${locationId}`);
  }
}

export class InvalidPhoneNumber extends BadRequestException {
  override readonly name = 'InvalidPhoneNumber';
  readonly code = 'InvalidPhoneNumber';

  constructor(phone: string) {
    super(`El teléfono no tiene un formato válido: ${phone}`);
  }
}
