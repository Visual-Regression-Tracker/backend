import {
  Column,
  Model,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
} from 'sequelize-typescript';
import { Build } from '../builds/build.entity';
import { TestStatus } from './test.status';
import { TestVariation } from 'src/test-variations/testVariation.entity';

@Table
export class TestRun extends Model<TestRun> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column
  imageName: string;

  @Column
  diffName: string;

  @Column({
    type: DataType.ENUM(
      TestStatus.new,
      TestStatus.unresolved,
      TestStatus.ok,
      TestStatus.failed,
    ),
  })
  status: TestStatus;

  @Column
  pixelMisMatchCount: number;

  @ForeignKey(() => Build)
  @Column({
    type: DataType.UUID,
  })
  buildId: string;

  @BelongsTo(() => Build, { onDelete: 'CASCADE', hooks: true})
  build: Build;

  @ForeignKey(() => TestVariation)
  @Column({
    type: DataType.UUID,
  })
  testVariationId: string;

  @BelongsTo(() => TestVariation, { onDelete: 'CASCADE', hooks: true})
  testVariation: TestVariation;
}
