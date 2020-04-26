import { Column, Model, Table, DataType, HasMany } from 'sequelize-typescript';
import { IgnoreArea } from '../tests/ignoreArea.entity';
import { TestRun } from 'src/test-runs/testRun.entity';

@Table
export class TestVariation extends Model<TestVariation> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column
  name: string;

  @Column
  baselineName: string;

  @Column
  os: string;

  @Column
  browser: string;

  @Column
  viewport: string;

  @Column
  device: string;

  @Column({
    type: DataType.JSON,
  })
  ignoreAreas: IgnoreArea[];

  @HasMany(() => TestRun)
  testRuns: TestRun[];
}
