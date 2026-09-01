import { Module } from '@nestjs/common';
import { TestFixturesController } from './test-fixtures.controller';

@Module({ controllers: [TestFixturesController] })
export class TestFixturesModule {}
