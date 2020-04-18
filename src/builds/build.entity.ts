import {
  Column,
  Model,
  Table,
  BelongsTo,
  ForeignKey,
} from 'sequelize-typescript';
import { User } from 'src/users/user.entity';
import { Project } from 'src/projects/project.entity';

@Table
export class Build extends Model<Build> {
  @Column
  number: number;

  @Column
  branchName: string;

  @Column
  status: string;

  @ForeignKey(() => Project)
  @Column
  projectId: number;

  @BelongsTo(() => Project)
  project: Project;

  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;
}
