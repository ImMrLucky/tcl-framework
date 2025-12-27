// Netlify serverless function to proxy API requests to TCL Core
exports.handler = async (event, context) => {
  const TCL_CORE_URL = process.env.NETLIFY_TCL_CORE_URL || 'http://localhost:8787';
  
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
      body: '',
    };
  }
  
  // Extract the path from query parameters (set by redirect rule)
  // The redirect sends: /api/validate -> /.netlify/functions/proxy?path=validate
  let path = '/validate'; // default
  
  if (event.queryStringParameters && event.queryStringParameters.path) {
    const pathParam = event.queryStringParameters.path;
    // Ensure it starts with /
    path = pathParam.startsWith('/') ? pathParam : '/' + pathParam;
  }
  
  // Fallback: try to extract from event.path
  const functionPath = '/.netlify/functions/proxy';
  if (event.path && event.path.startsWith(functionPath) && event.path.length > functionPath.length) {
    path = event.path.substring(functionPath.length);
  }
  
  const url = `${TCL_CORE_URL}${path}`;
  
  try {
    // Forward the request to TCL Core
    const headers = {
      'Content-Type': 'application/json',
    };
    
    // Forward authorization if present
    if (event.headers.authorization) {
      headers['Authorization'] = event.headers.authorization;
    }
    
    const response = await fetch(url, {
      method: event.httpMethod,
      headers: headers,
      body: event.body || undefined,
    });
    
    const data = await response.text();
    
    return {
      statusCode: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      },
      body: data,
    };
  } catch (error) {
    console.error('Proxy error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ error: error.message || 'Proxy error' }),
    };
  }
};
