import {
  Column,
  Model,
  Table,
  DataType,
  HasMany,
  ForeignKey,
  BelongsTo,
} from 'sequelize-typescript';
import { TestRun } from 'src/test-runs/testRun.entity';
import { IgnoreAreaDto } from 'src/test/dto/ignore-area.dto';
import { Project } from 'src/projects/project.entity';

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

  @ForeignKey(() => Project)
  @Column({
    type: DataType.UUID,
  })
  projectId: string;

  @BelongsTo(() => Project, { onDelete: 'CASCADE', hooks: true})
  project: Project;
}
