import { ENV } from "./env.js";

export function getConfig() {
    return {
        gitlabToken: ENV.GITLAB_TOKEN,
        projectId: ENV.GITLAB_PROJECT_ID,
        baseUrl: ENV.GITLAB_BASE_URL
    };
}