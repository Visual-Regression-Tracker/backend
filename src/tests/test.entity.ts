import {
  Column,
  Model,
  Table,
  BelongsTo,
  ForeignKey,
  DataType,
} from 'sequelize-typescript';
import { Build } from 'src/builds/build.entity';
import { TestStatus } from './test.status';

@Table
export class Test extends Model<Test> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column
  name: string;

  @Column
  baselineUrl: string;

  @Column
  imageUrl: string;

  @Column
  diffUrl: string;

  @Column
  os: string;

  @Column
  browser: string;

  @Column
  viewport: string;

  @Column
  device: string;

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

  @BelongsTo(() => Build)
  build: Build;
}
