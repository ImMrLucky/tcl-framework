/**
 * Base Connector Interface
 * All integration connectors implement this interface
 */
export class BaseConnector {
    context;
    constructor(context) {
        this.context = context;
    }
}
/**
 * Ingest Connector - for bringing data in
 */
export class IngestConnector extends BaseConnector {
}
/**
 * Export Connector - for sending data out
 */
export class ExportConnector extends BaseConnector {
}
