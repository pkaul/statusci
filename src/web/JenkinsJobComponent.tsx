import * as React from "react";
import {
    JenkinsClient, JenkinsJobResponse, isBuilding, JenkinsBuildResponse, getProgressPercent, JenkinsBuildStatus, getBuildStatus, isSingleJob, isMultiJob, JenkinsJobRefResponse, JenkinsMultiJobResponse
} from "./JenkinsClient";
import {getConfig, ServerConfig} from "./ServerConfigComponent";
import {Styles} from "./Styles";

/**
 * React component for rendering Jenkins job status
 */
export class JenkinsJobComponent extends React.Component<JobProperties, JobState | MultiJobState | LoadingState > {

    private static LOADING:string           = "loading";
    private static LOADING_DONE:string      = "loading-done";
    private static LOADING_ERROR:string     = "loading-error";

    private _refreshInterval:number = 5000;
    private _triggerHandle:number;

    constructor(props: JobProperties) {
        super(props);
        if( !props.server || !props.id ) {
            throw new Error("Missing property 'server' and/or 'name': "+JSON.stringify(props));
        }
    }

    public componentWillMount():void {
        this.triggerLoadJob();
    }

    public componentWillUnmount():void {
        window.clearTimeout(this._triggerHandle);
    }

    public render():JSX.Element {

        if( !!(this.state as JobState).buildStatus ) {
            return this.renderJob(this.state as JobState);
        }
        else if( !!(this.state as MultiJobState).jobs ) {
            return this.renderMultiJob(this.state as MultiJobState);
        }
        else {
            return this.renderLoading(this.state as LoadingState);
        }
    }

    // --------------

    private renderLoading(job:LoadingState):JSX.Element {
        let className:string = `status ${job.loadStatus}`;
        return <div className={className}><h3>{job.name}</h3></div>;
    }

    private renderMultiJob(jobs:MultiJobState):JSX.Element {

        return <div>
                    {
                        jobs.jobs.map(item =>
                            // dynamically create a React component with a virtual job id
                            React.createElement(JenkinsJobComponent, {"server": this.props.server, "id": this.props.id+"/job/"+item.name}, null)
                        )
                    }
                </div>;
    }

    private renderJob(job:JobState):JSX.Element {

        const now:number = new Date().getTime();

        // age: distinct value between 0 and 5
        let age:number = null;
        if( !job.building && job.buildTimestamp ) {

            // distinct age values are based on 6-hours intervals
            const ageIntervalMillis:number = 6 * 60 * 60 * 1000; // 6 hours
            age = Math.round((now - job.buildTimestamp) / ageIntervalMillis);
            if (age < 0) {
                age = 0;
            }
            if (age > 5) {
                age = 5;
            }
        }

        // const jobUrl = this.state.jobUrl;
        let className:string = `status ${job.loadStatus} ${job.buildStatus}`;
        if( job.building ) {
            className += " building";
        }
        if( age ) {
            className += " age-"+age;
        }

        let progressBar = null;
        if( job.building ) {
            progressBar =  <progress value={job.buildProgress} max="100"></progress>;
        }
        const infoString:string = "Date: "+new Date(job.buildTimestamp)+"\nTest: Hello";   // TODO

        return <div className={className} title={infoString}>
            <h3><a href={job.url} target="_blank">{job.name}</a></h3>
            {progressBar}
        </div>;
    }

    private triggerLoadJob():void {

        let interval:number = this._refreshInterval+Math.random()*500;

        this.setState({
            "name": this.getDisplayNameFromPropOrState(),
            "loadStatus": JenkinsJobComponent.LOADING,
        });
        this.loadJob().then((state: JobState | MultiJobState) => {
                this.setState(state);
                this._triggerHandle = window.setTimeout(() => this.triggerLoadJob(), interval);
            }).catch(() => {
                this._triggerHandle = window.setTimeout(() => this.triggerLoadJob(), interval);
            });
    }


    private loadJob(): Promise<JobState | MultiJobState> {

        const client: JenkinsClient = this.getClient();
        return client.read(this.props.id).then((job: JenkinsJobResponse | JenkinsMultiJobResponse) => {

                // determine name: lookup explicit name from properties, from job definition and (fallback) use id
                let name: string = !!this.props.name ? this.props.name : job.displayName;
                if (!name) {
                    name = this.props.id;
                }
                //
                if (isSingleJob(job)) {

                    let singleJob: JenkinsJobResponse = job as JenkinsJobResponse;
                    return client.readBuild(singleJob.lastBuild).then((build: JenkinsBuildResponse) => {

                        return Promise.resolve({
                            "name": name,
                            "url": job.url,
                            "loadStatus": JenkinsJobComponent.LOADING_DONE,
                            "buildCount": singleJob && singleJob.builds ? singleJob.builds.length : 0,
                            "buildStatus": JenkinsJobComponent.asStatusStyle(singleJob),
                            "building": isBuilding(singleJob),
                            "buildProgress": getProgressPercent(build),
                            "buildTimestamp": build.timestamp
                        } as JobState) as Promise<JobState | MultiJobState>
                    });
                }
                else if (isMultiJob(job)) {

                    let multiJob: JenkinsMultiJobResponse = job as JenkinsMultiJobResponse;
                    return Promise.resolve({
                        "name": this.getDisplayNameFromPropOrState(),
                        "loadStatus": JenkinsJobComponent.LOADING_DONE,
                        "jobs": multiJob.jobs
                    }) as Promise<JobState | MultiJobState>;
                }
                else {

                    // not supported
                    throw new Error("Unsupported format: " + JSON.stringify(job));
                }

            }, (error: any) => {
                console.log("Error " + error);
                return Promise.resolve({
                    "name": this.getDisplayNameFromPropOrState(),
                    "loadStatus": JenkinsJobComponent.LOADING_ERROR,
                    "buildStatus": Styles.STATUS_NONE
                } as JobState);
            }
        );
    }

    // -----------

    private getDisplayNameFromPropOrState():string {

        if( !!this.state && this.state.name ) {
            // name is already defined by state
            return this.state.name;
        }
        else {
            // use name or fallback to id
            return !!this.props.name ? this.props.name : this.props.id;
        }
    }

    private getClient():JenkinsClient {
        let config:ServerConfig = this.getConfig();
        return new JenkinsClient(config.url, config.username, config.password);
    }

    private getConfig():ServerConfig {
        return getConfig(this.props.server);
    }

    private static asStatusStyle(job:JenkinsJobResponse):string {

        let status:JenkinsBuildStatus = getBuildStatus(job);
        if( status === JenkinsBuildStatus.SUCCESS ) {
            return Styles.STATUS_SUCCESS;
        }
        else if( status === JenkinsBuildStatus.WARN ) {
            return Styles.STATUS_WARN;
        }
        else if( status === JenkinsBuildStatus.ERROR ) {
            return Styles.STATUS_ERROR;
        }
        else {
            return Styles.STATUS_NONE;
        }
    }
}





export interface JobProperties {
    // server (id from server element) to use for this use
    server: string,
    // jenkins job id
    id: string,
    // optional human readable name to be shown by this component
    name?:string
}

interface LoadingState {
    // display name
    name:string;

    // loading css class
    loadStatus: string;
}

interface JobState extends LoadingState {

    url:string;
    buildCount: number;
    buildStatus: string;
    // whether job is currently building
    building:boolean;
    // progress (0..100) for build to finish
    buildProgress:number;
    buildTimestamp:number;
}

interface MultiJobState extends LoadingState {
    jobs:JenkinsJobRefResponse[]
}



