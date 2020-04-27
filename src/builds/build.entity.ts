import {
  Column,
  Model,
  Table,
  BelongsTo,
  ForeignKey,
  HasMany,
  DataType,
} from 'sequelize-typescript';
import { User } from 'src/users/user.entity';
import { Project } from 'src/projects/project.entity';
import { TestRun } from 'src/test-runs/testRun.entity';

@Table
export class Build extends Model<Build> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  id: string;

  @Column
  number: number;

  @Column
  branchName: string;

  @Column
  status: string;

  @ForeignKey(() => Project)
  @Column({
    type: DataType.UUID,
  })
  projectId: string;

  @BelongsTo(() => Project)
  project: Project;

  @ForeignKey(() => User)
  @Column({
    type: DataType.UUID,
  })
  userId: string;

  @BelongsTo(() => User)
  user: User;

  @HasMany(() => TestRun, { onDelete: 'CASCADE', hooks: true})
  testRuns: TestRun[];
}
