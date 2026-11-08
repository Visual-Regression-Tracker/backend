import { ConflictException, NotFoundException } from '@nestjs/common';
import { TestRun } from '@prisma/client';
import { IgnoreAreaDto } from './dto/ignore-area.dto';
import { parseIgnoreAreas } from '../utils';

export const testRunNotFound = (id: string) => new NotFoundException(`Test run not found: ${id}`);

export class TestRunAlreadyDecidedException extends ConflictException {}

export const NO_TEST_VARIATION = 'No test variation found. Re-create test run';

export const getAllIgnoreAreas = (testRun: TestRun): IgnoreAreaDto[] =>
  parseIgnoreAreas(testRun.ignoreAreas).concat(parseIgnoreAreas(testRun.tempIgnoreAreas));
