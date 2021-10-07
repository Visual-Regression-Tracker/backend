import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from 'rxjs/operators';
import { VRTUserLogService } from "./user-log.service";

@Injectable()
export class UserLogInterceptor implements NestInterceptor {

    constructor(private logService: VRTUserLogService) { }

    async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
        const request: Request = context.switchToHttp().getRequest();
        const response: any = context.switchToHttp().getResponse();
        let description: string;
        //When we delete an entry from database, it is important to collect information before deleting so that we can log it properly.
        if (request.method.includes('DELETE') || this.isTestRunDelete(request)) {
            description = await this.logService.getLogDescriptionBeforeDeletingFromDB('', request);
        }
        return next
            .handle()
            .pipe(
                tap(() => {
                    if (this.isResponseSuccessful(response)) {
                        //Description will be recreated in logService if it is undefined.
                        this.logService.postData(request, description);
                    }
                }),
            );
    }

    private isTestRunDelete(request: Request): boolean {
        return request.url.includes('test-runs/delete') && request.method.includes('POST');
    }

    private isResponseSuccessful(response: any) {
        return response.statusCode >= 200 && response.statusCode < 300
    }

}
