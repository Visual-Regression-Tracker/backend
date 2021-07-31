import { IsNotEmpty, IsUUID } from 'class-validator';

export class MergeParams {
  @IsUUID()
  projectId: string;
  @IsNotEmpty()
  fromBranch: string;
  @IsNotEmpty()
  toBranch: string;
}
