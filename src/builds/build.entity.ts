import {
  Column,
  Model,
  Table,
  BelongsTo,
  ForeignKey,
} from 'sequelize-typescript';
import { User } from 'src/users/user.entity';

@Table
export class Build extends Model<Build> {
  @Column
  number: number;

  @Column
  branchName: string;

  @Column
  status: string;

  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;
}
