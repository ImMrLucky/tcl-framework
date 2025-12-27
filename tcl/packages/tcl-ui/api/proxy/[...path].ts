// Vercel serverless function to proxy API requests to TCL Core
// This catch-all route handles /api/proxy/* paths
import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return response.status(200).json({});
  }

  const TCL_CORE_URL = process.env.VERCEL_TCL_CORE_URL || process.env.TCL_CORE_URL || 'http://localhost:8787';
  
  // Get the path from the catch-all parameter
  // request.query.path will be an array like ['validate'] or ['api', 'validate']
  const pathArray = request.query.path as string[] | string | undefined;
  let path = '/validate'; // default
  
  if (pathArray) {
    if (Array.isArray(pathArray)) {
      path = '/' + pathArray.join('/');
    } else {
      path = '/' + pathArray;
    }
  }
  
  // Ensure path starts with /
  if (!path.startsWith('/')) {
    path = '/' + path;
  }
  
  const url = `${TCL_CORE_URL}${path}`;

  try {
    // Forward the request to TCL Core
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Forward authorization if present
    if (request.headers.authorization) {
      headers['Authorization'] = request.headers.authorization;
    }

    const fetchResponse = await fetch(url, {
      method: request.method,
      headers: headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' 
        ? JSON.stringify(request.body) 
        : undefined,
    });

    const data = await fetchResponse.text();

    // Set CORS headers
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return response.status(fetchResponse.status).send(data);
  } catch (error: any) {
    console.error('Proxy error:', error);
    return response.status(500).json({ 
      error: error.message || 'Proxy error' 
    });
  }
}

