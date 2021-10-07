import { HttpService, Injectable, Logger } from "@nestjs/common";
import { map } from "rxjs/operators";
import { PrismaService } from "../../prisma/prisma.service";
import { UserLogDto } from "../../user-logs/dto/user-log.dto";

enum LOG_NAMES {
    PROFILE_UPDATED = 'profile_updated',
    PROFILE_PASSWORD_CHANGED = 'profile_password_changed',
    PROJECT_CREATED = 'project_created',
    PROJECT_DETAILS_UPDATED = 'project_updated',
    PROJECT_DELETED = 'project_deleted',
    BUILD_CREATED = 'build_created',
    BUILD_DELETED = 'build_deleted',
    USER_CREATED = 'user_created',
    USER_DELETED = 'user_deleted',
    TEST_RUNS_DELETED = 'test_runs_deleted',
    TEST_RUNS_UPDATED = 'test_runs_approved_rejected',
    TEST_RUNS_APPROVED = 'test_runs_approved',
    TEST_RUNS_REJECTED = 'test_runs_rejected',
    UNKNOWN = 'unknown',
}

type BuildDetails = {
    buildId: string;
    buildSerialNumber: number;
    projectId: string;
    projectName: string;
};

@Injectable()
export class VRTUserLogService {

    private readonly logger: Logger = new Logger(VRTUserLogService.name);

    constructor(private prismaService: PrismaService, private httpService: HttpService) { }

    async getLogs(numberOfRecordsNeeded: number) {
        return this.httpService.post(`${process.env.ELASTIC_URL}/vrt-user-log/_search`,
            { "size": numberOfRecordsNeeded, "sort": [{ "@timestamp": "desc" }], "_source": ["vrtEventType", "vrtUser", "vrtMessage"] },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
            }).pipe(
                map(response => response.data),
            ).toPromise().catch(e => {
            });
    }

    async getLastLog() {
        const lastLogsResponse = await this.getLogs(1);
        if (lastLogsResponse) {
            let recentLogs: UserLogDto[] = lastLogsResponse.hits.hits;
            let recentLogsDto = recentLogs.map(each => new UserLogDto(each))
            return recentLogsDto[0];
        }
    }

    async postData(request: Request, description: string) {

        let user = await this.getUserEmail(request);
        const eventType = this.getEventyType(request);
        //description will be undefined if it was not computed as part of pre-delete info collection from DB.
        if (!description && eventType !== LOG_NAMES.TEST_RUNS_DELETED) {
            description = await this.getLogDescription(user, eventType, request);
        }
        //Case when previous log is similar to current log (example multiple test run approval) or when test run requests do not contain a body.
        if (description.length === 0) {
            return;
        }
        this.logger.log(eventType.toString() + " ## " + user + " ## " + description);
    }

    async getLogDescriptionBeforeDeletingFromDB(user: string, request: any) {
        const eventType = this.getEventyType(request);
        const description = await this.getLogDescription(user, eventType, request);
        return description;
    }

    async getLogDescription(currentUser: string, eventType: LOG_NAMES, request: any) {
        switch (eventType) {
            case LOG_NAMES.USER_CREATED: {
                return `${request.body.email} user created.`;
            }
            case LOG_NAMES.USER_DELETED: {
                let userEmail = await this.prismaService.user.findUnique({
                    where: {
                        id: request.body[0],
                    }
                });
                return `${userEmail.email} is deleted.`;
            }
            case LOG_NAMES.PROFILE_UPDATED: {
                return `Profile updated for ${await this.getUserEmail(request)}`;
            }
            case LOG_NAMES.PROFILE_PASSWORD_CHANGED: {
                return `Password changed for ${await this.getUserEmail(request)}`;
            }
            case LOG_NAMES.PROJECT_CREATED: {
                return `Project '${request.body.name}' is created.`;
            }
            case LOG_NAMES.PROJECT_DELETED: {
                const projectId: string = request.url.split('/')[2];
                let projectFromDB = await this.prismaService.project.findUnique({
                    where: {
                        id: projectId,
                    }
                });
                return `Project '${projectFromDB.name}'(${projectId}) is deleted.`;
            }
            case LOG_NAMES.PROJECT_DETAILS_UPDATED: {
                return `'${request.body.name}' project is updated.`;
            }
            case LOG_NAMES.BUILD_CREATED: {
                const projectId = request.body.project;
                const projectNameFromDB = await this.prismaService.project.findUnique({
                    where: {
                        id: projectId,
                    }
                });
                return `Build created for '${projectNameFromDB.name}'(${projectId}) for branch '${request.body.branchName}' with ciBuildId '${request.body.ciBuildId}'.`;
            }
            case LOG_NAMES.BUILD_DELETED: {
                const buildId: string = request.url.split('/')[2];
                const buildDetails = await this.getBuildAndProjectDetails(buildId);
                return `Build deleted for project '${buildDetails.projectName}' (${buildDetails.projectId}) and build (${buildDetails.buildId}) with serial number ${buildDetails.buildSerialNumber}.`;
            }
            case LOG_NAMES.TEST_RUNS_DELETED:
            case LOG_NAMES.TEST_RUNS_APPROVED:
            case LOG_NAMES.TEST_RUNS_REJECTED: {
                const testRunIds = request.body as Array<string>;
                if (testRunIds.length === 0) {
                    return '';
                }
                const testRunDetailsFromDB = await this.prismaService.testRun.findFirst({
                    where: {
                        id: testRunIds[0],
                    }
                });

                const buildId = testRunDetailsFromDB.buildId;
                const lastLog = await this.getLastLog();
                if (!currentUser || currentUser.length === 0) {
                    currentUser = await this.getUserEmail(request);
                }
                const isLastLogSimilar = this.isLastLogSimilar(currentUser, lastLog, buildId, eventType);
                //If last log is similar, consolidate the log. Otherwise, there will be too many logs especially when user navigates in test run details and approved images one by one.
                if (isLastLogSimilar) {
                    return '';
                }
                const action = (eventType === LOG_NAMES.TEST_RUNS_DELETED) ? 'deleted from' : 'updated in';
                const buildDetails = await this.getBuildAndProjectDetails(buildId);
                return `${testRunIds.length} test run(s) ${action} project '${buildDetails.projectName}' (${buildDetails.projectId}) and build (${buildDetails.buildId}) with serial number ${buildDetails.buildSerialNumber}.`;
            }
            default: {
                return '';
            }
        }
    }

    isLastLogSimilar(currentUser: string, lastLog: UserLogDto, buildId: string, eventType: LOG_NAMES): boolean {
        if (lastLog) {
            if (!(lastLog.user.includes(currentUser) && lastLog.description.includes(buildId))) {
                return false;
            }
            if (eventType === LOG_NAMES.TEST_RUNS_DELETED && lastLog.eventType === eventType) {
                return true;
            }
            if (lastLog.eventType === LOG_NAMES.TEST_RUNS_APPROVED || lastLog.eventType === LOG_NAMES.TEST_RUNS_REJECTED) {
                return true;
            }
        }
        return false;
    }

    async getBuildAndProjectDetails(buildId: string): Promise<BuildDetails> {
        const buildDetailsFromDB = await this.prismaService.build.findUnique({
            where: {
                id: buildId,
            }
        });
        const projectDetailsFromDB = await this.prismaService.project.findUnique({
            where: {
                id: buildDetailsFromDB.projectId,
            }
        });
        const buildDetails: BuildDetails = {
            'buildId': buildId,
            'projectId': buildDetailsFromDB.projectId,
            'projectName': projectDetailsFromDB.name,
            'buildSerialNumber': buildDetailsFromDB.number
        }
        return buildDetails;
    }

    async getUserEmail(request: any): Promise<string> {
        let user = request.user ? request.user.email : request.headers.apikey;
        if (user && !user.includes('@')) {
            //We got apikey instead of email, so fetch email from the database.
            let userFromDB = await this.prismaService.user.findUnique({
                where: {
                    apiKey: user,
                }
            })
            user = userFromDB.email;
        }
        return user = user ? user : '';
    }

    private getEventyType(request: any): LOG_NAMES {
        const method: string = request.method;
        const url: string = request.url;
        if (url.startsWith('/users/password')) {
            return LOG_NAMES.PROFILE_PASSWORD_CHANGED;
        }
        if (url.startsWith('/users') && method.includes('DELETE')) {
            return LOG_NAMES.USER_DELETED;
        }
        if (url.startsWith('/users') && method.includes('POST')) {
            return LOG_NAMES.USER_CREATED;
        }
        if (url.startsWith('/users')) {
            return LOG_NAMES.PROFILE_UPDATED;
        }
        if (url.startsWith("/test-runs/delete")) {
            return LOG_NAMES.TEST_RUNS_DELETED;
        }
        if (url.startsWith("/test-runs/approve")) {
            return LOG_NAMES.TEST_RUNS_APPROVED;
        }
        if (url.startsWith("/test-runs/reject")) {
            return LOG_NAMES.TEST_RUNS_REJECTED;
        }
        if (url.startsWith("/builds/") && method.includes('DELETE')) {
            return LOG_NAMES.BUILD_DELETED;
        }
        if (url.startsWith("/builds") && method.includes('POST')) {
            return LOG_NAMES.BUILD_CREATED;
        }
        if (url.startsWith("/projects") && method.includes('POST')) {
            return LOG_NAMES.PROJECT_CREATED;
        }
        if (url.startsWith("/projects") && method.includes('DELETE')) {
            return LOG_NAMES.PROJECT_DELETED;
        }
        if (url.startsWith("/projects") && method.includes('PUT')) {
            return LOG_NAMES.PROJECT_DETAILS_UPDATED;
        }
        return LOG_NAMES.UNKNOWN;
    }

}
