import AWS from 'aws-sdk';
import type { ConnectorProvider, ConnectorConfig, ConnectorSecrets, ListOptions, ListResult, ConnectorObject, FetchResult } from './connector-provider.js';

/**
 * S3 Connector Provider
 */
export class S3ConnectorProvider implements ConnectorProvider {
  async testConnection(config: ConnectorConfig, secrets: ConnectorSecrets): Promise<{ success: boolean; error?: string }> {
    try {
      const { bucket, region } = config;
      const { accessKeyId, secretAccessKey } = secrets;

      if (!bucket || !region || !accessKeyId || !secretAccessKey) {
        return { success: false, error: 'Missing required S3 configuration (bucket, region, accessKeyId, secretAccessKey)' };
      }

      const s3 = new AWS.S3({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      // Test by listing objects (limit 1)
      await s3.listObjectsV2({
        Bucket: bucket,
        MaxKeys: 1,
      }).promise();

      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to connect to S3' };
    }
  }

  async list(options: ListOptions, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<ListResult> {
    const { bucket, region } = config;
    const { accessKeyId, secretAccessKey } = secrets;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing required S3 configuration');
    }

    const s3 = new AWS.S3({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    const prefix = options.prefix || options.path || '';
    const limit = options.limit || 100;
    const continuationToken = options.offset ? String(options.offset) : undefined;

    const params: AWS.S3.ListObjectsV2Request = {
      Bucket: bucket,
      Prefix: prefix,
      MaxKeys: limit,
      ContinuationToken: continuationToken,
    };

    if (!options.recursive) {
      params.Delimiter = '/';
    }

    const response = await s3.listObjectsV2(params).promise();

    const objects: ConnectorObject[] = [];

    // Add common prefixes (directories)
    if (response.CommonPrefixes) {
      for (const commonPrefix of response.CommonPrefixes) {
        if (commonPrefix.Prefix) {
          objects.push({
            id: commonPrefix.Prefix,
            name: commonPrefix.Prefix.split('/').filter(Boolean).pop() || commonPrefix.Prefix,
            path: commonPrefix.Prefix,
            isDirectory: true,
          });
        }
      }
    }

    // Add objects (files)
    if (response.Contents) {
      for (const object of response.Contents) {
        if (object.Key && object.Key !== prefix) {
          objects.push({
            id: object.Key,
            name: object.Key.split('/').pop() || object.Key,
            path: object.Key,
            size: object.Size,
            modifiedAt: object.LastModified?.toISOString(),
            isDirectory: false,
            metadata: {
              etag: object.ETag,
              storageClass: object.StorageClass,
            },
          });
        }
      }
    }

    return {
      objects,
      hasMore: response.IsTruncated || false,
      nextOffset: response.NextContinuationToken ? parseInt(response.NextContinuationToken) : undefined,
    };
  }

  async fetchObject(ref: string, config: ConnectorConfig, secrets: ConnectorSecrets): Promise<FetchResult> {
    const { bucket, region } = config;
    const { accessKeyId, secretAccessKey } = secrets;

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new Error('Missing required S3 configuration');
    }

    const s3 = new AWS.S3({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Get object metadata first
    const headResponse = await s3.headObject({
      Bucket: bucket,
      Key: ref,
    }).promise();

    // Get object stream
    const getResponse = await s3.getObject({
      Bucket: bucket,
      Key: ref,
    }).promise();

    if (!getResponse.Body) {
      throw new Error('Object body is empty');
    }

    // Convert Buffer to ReadableStream if needed
    let stream: NodeJS.ReadableStream;
    if (Buffer.isBuffer(getResponse.Body)) {
      const { Readable } = await import('stream');
      stream = Readable.from(getResponse.Body);
    } else {
      stream = getResponse.Body as NodeJS.ReadableStream;
    }

    return {
      stream,
      metadata: {
        size: headResponse.ContentLength || 0,
        mimeType: headResponse.ContentType,
        lastModified: headResponse.LastModified?.toISOString(),
      },
    };
  }

  async createBatchFromSelection(
    selection: ConnectorObject[],
    config: ConnectorConfig,
    secrets: ConnectorSecrets
  ): Promise<{ batchId: string; itemCount: number }> {
    // This is a placeholder - actual implementation would create batch in database
    // The batch creation should be handled by the batch ingestion routes
    throw new Error('createBatchFromSelection should be called via batch ingestion API');
  }
}

export const s3Connector = new S3ConnectorProvider();

