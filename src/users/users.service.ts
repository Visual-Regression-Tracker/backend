import { Injectable, Inject } from '@nestjs/common';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @Inject('UsersRepository')
    private userModel: typeof User,
  ) {}

  async findAll(): Promise<User[]> {
    return this.userModel.findAll();
  }

  findOne(id: string): Promise<User> {
    return this.userModel.findOne({
      where: {
        id,
      },
    });
  }
}
