import AWS from 'aws-sdk';
/**
 * Create S3 client with credentials (assume-role or static keys)
 */
async function createS3Client(config, secrets) {
    const { bucket, region } = config;
    const { roleArn, externalId, accessKeyId, secretAccessKey } = secrets;
    if (!bucket || !region) {
        throw new Error('Missing required S3 configuration (bucket, region)');
    }
    // Prefer assume-role if available
    if (roleArn && externalId) {
        const sts = new AWS.STS({
            region: region || 'us-east-1',
        });
        // Assume role
        const assumeRoleResponse = await sts.assumeRole({
            RoleArn: roleArn,
            RoleSessionName: `tcl-connector-${Date.now()}`,
            ExternalId: externalId,
            DurationSeconds: 3600, // 1 hour
        }).promise();
        if (!assumeRoleResponse.Credentials) {
            throw new Error('Failed to assume role: no credentials returned');
        }
        const credentials = assumeRoleResponse.Credentials;
        return new AWS.S3({
            region,
            credentials: {
                accessKeyId: credentials.AccessKeyId,
                secretAccessKey: credentials.SecretAccessKey,
                sessionToken: credentials.SessionToken,
            },
        });
    }
    else if (accessKeyId && secretAccessKey) {
        // Fallback to static keys (dev mode only)
        const ALLOW_STATIC_KEYS = process.env.ALLOW_DEV_CONNECTOR_SECRETS_FROM_CLIENT === 'true';
        if (!ALLOW_STATIC_KEYS) {
            throw new Error('Static keys not allowed in production. Use assume-role.');
        }
        return new AWS.S3({
            region,
            credentials: {
                accessKeyId,
                secretAccessKey,
            },
        });
    }
    else {
        throw new Error('Missing S3 credentials (roleArn+externalId or accessKeyId+secretAccessKey)');
    }
}
/**
 * S3 Connector Provider
 */
export class S3ConnectorProvider {
    async testConnection(config, secrets) {
        try {
            const s3 = await createS3Client(config, secrets);
            const { bucket } = config;
            if (!bucket) {
                return { success: false, error: 'Missing required S3 configuration (bucket)' };
            }
            // Test by listing objects (limit 1)
            await s3.listObjectsV2({
                Bucket: bucket,
                MaxKeys: 1,
            }).promise();
            return { success: true };
        }
        catch (error) {
            return { success: false, error: error.message || 'Failed to connect to S3' };
        }
    }
    async list(options, config, secrets) {
        const s3 = await createS3Client(config, secrets);
        const { bucket } = config;
        if (!bucket) {
            throw new Error('Missing required S3 configuration (bucket)');
        }
        const prefix = options.prefix || options.path || '';
        const limit = options.limit || 100;
        const continuationToken = options.offset ? String(options.offset) : undefined;
        const params = {
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: limit,
            ContinuationToken: continuationToken,
        };
        if (!options.recursive) {
            params.Delimiter = '/';
        }
        const response = await s3.listObjectsV2(params).promise();
        const objects = [];
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
    async fetchObject(ref, config, secrets) {
        const s3 = await createS3Client(config, secrets);
        const { bucket } = config;
        if (!bucket) {
            throw new Error('Missing required S3 configuration (bucket)');
        }
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
        let stream;
        if (Buffer.isBuffer(getResponse.Body)) {
            const { Readable } = await import('stream');
            stream = Readable.from(getResponse.Body);
        }
        else {
            stream = getResponse.Body;
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
    async createBatchFromSelection(selection, config, secrets) {
        // This is a placeholder - actual implementation would create batch in database
        // The batch creation should be handled by the batch ingestion routes
        throw new Error('createBatchFromSelection should be called via batch ingestion API');
    }
}
export const s3Connector = new S3ConnectorProvider();
