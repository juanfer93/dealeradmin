import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

const TEXT_LIMIT = 10_000;

export class CreateManualLeadRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  phone!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  vehicle_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  down_payment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  purchase_timeline?: string;

  @IsOptional()
  @IsString()
  @MaxLength(TEXT_LIMIT)
  documents?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  identification?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  bank_account?: string;
}

export class UpdateLeadRequestDto extends CreateManualLeadRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  dealerId!: string;
}

export class BulkLeadImportRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100_000)
  text!: string;
}

export class LeadStatusRequestDto {
  @IsIn(['sent'])
  status!: 'sent';

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  dealerId!: string;
}

export class ReassignLeadRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  currentDealerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  targetDealerId!: string;
}

export class CopyLeadRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  sourceDealerId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  targetDealerId!: string;
}

export class BulkDeleteItemRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  leadId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  dealerId!: string;
}

export class BulkDeleteRequestDto {
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkDeleteItemRequestDto)
  items!: BulkDeleteItemRequestDto[];
}
