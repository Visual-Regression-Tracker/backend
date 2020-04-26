import { Column, Model, Table, DataType, HasMany } from 'sequelize-typescript';
import { TestRun } from 'src/test-runs/testRun.entity';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';

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
    defaultValue: [],
  })
  ignoreAreas: IgnoreAreaDto[];

  @HasMany(() => TestRun)
  testRuns: TestRun[];
}
