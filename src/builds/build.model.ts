import { Column, Model, Table, HasOne } from 'sequelize-typescript';
import { User } from 'src/users/user.model';

@Table
export class Build extends Model<Build> {
  @Column
  number: number;

  @Column
  branch: string;

  @Column
  status: string;

  @HasOne(() => User)
  startedBy: User;
}
