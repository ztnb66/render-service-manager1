// Cloudflare Worker for Multi-Account Render Service Management System
// Render API Documentation: https://api-docs.render.com/reference/introduction

/**
 * 主入口点 - 监听所有请求并路由到处理器
 */
addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

/**
 * 环境变量说明:
 * - ADMIN_USERNAME: 管理员登录用户名
 * - ADMIN_PASSWORD: 管理员登录密码
 * - RENDER_ACCOUNTS: 账户配置的JSON字符串
 * - SESSION_SECRET: 会话签名密钥
 * - KV_NAMESPACE: 用于会话存储的KV命名空间
 */

/**
 * 主请求处理器
 * @param {Request} request - 传入的请求
 * @returns {Promise<Response>} - 响应
 */
async function handleRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  
  console.log(`处理请求: ${request.method} ${path}`);
  
  // 路由处理 - 先检查精确匹配，然后是模式匹配
  if (path === '/login' && request.method === 'POST') {
    return handleLogin(request);
  } else if (path === '/login' && request.method === 'GET') {
    return renderLoginPage();
  } else if (path === '/logout') {
    return handleLogout(request);
  } else if (path === '/api/services' && request.method === 'GET') {
    return handleGetServices(request);
  } else if (path === '/api/deploy' && request.method === 'POST') {
    return handleDeploy(request);
  } else if (path.startsWith('/api/events/') && request.method === 'GET') {
    return handleGetEvents(request);
  } else if (path.startsWith('/api/env-vars/') && request.method === 'GET') {
    return handleGetEnvVars(request);
  } else if (path.startsWith('/api/env-vars/') && request.method === 'PUT') {
    // 检查是更新所有环境变量还是单个环境变量
    const pathParts = path.split('/');
    if (pathParts.length === 4) {
      // /api/env-vars/{serviceId} - 更新所有环境变量
      return handleUpdateAllEnvVars(request);
    } else if (pathParts.length >= 5) {
      // /api/env-vars/{accountId}/{serviceId}/{envVarKey} - 更新单个环境变量
      return handleUpdateSingleEnvVar(request);
    }
  } else if (path.startsWith('/api/env-vars/') && request.method === 'DELETE') {
    return handleDeleteEnvVar(request);
  } else if (path === '/') {
    return handleMainPage(request);
  } else {
    // 静态资源或404
    console.log(`未找到路由: ${request.method} ${path}`);
    return new Response('Not Found', { status: 404 });
  }
}

/**
 * 处理获取事件日志请求
 * @param {Request} request - 事件请求
 * @returns {Promise<Response>} - 事件响应
 */
async function handleGetEvents(request) {
  console.log('调用handleGetEvents');
  
  // 验证会话
  const session = await verifySession(request);
  if (!session) {
    console.log('会话验证失败');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
  
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    console.log('路径部分:', pathParts);
    
    const accountNameOrId = pathParts[3];
    const serviceId = pathParts[4];
    
    console.log(`提取的accountNameOrId: ${accountNameOrId}, serviceId: ${serviceId}`);
    
    // 通过ID或名称查找账户（不区分大小写）
    const accounts = JSON.parse(RENDER_ACCOUNTS);
    const account = accounts.find(acc => 
      acc.id === accountNameOrId || 
      acc.name.toLowerCase() === accountNameOrId.toLowerCase()
    );
    
    if (!account) {
      console.log(`找不到账户: ${accountNameOrId}`);
      return new Response(JSON.stringify({ error: '找不到账户' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    console.log(`找到账户: ${account.name} (ID: ${account.id})`);
    
    // 获取事件日志
    const events = await getEventsForService(account, serviceId);
    console.log(`获取了 ${events.length} 条事件日志`);
    
    return new Response(JSON.stringify(events), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('获取事件日志出错:', error);
    return new Response(JSON.stringify({ error: '获取事件日志失败' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * 获取服务的事件日志
 * @param {Object} account - 账户配置
 * @param {string} serviceId - 服务ID
 * @returns {Promise<Array>} - 事件列表
 */
async function getEventsForService(account, serviceId) {
  console.log(`获取服务的事件日志: ${serviceId}`);
  
  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/events?limit=5`, {
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${account.apiKey}`
    }
  });
  
  if (!response.ok) {
    console.error(`获取事件日志失败: ${response.status} ${response.statusText}`);
    throw new Error(`获取事件日志失败: ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log('事件日志响应:', data);
  
  return data;
}

/**
 * 处理用户登录
 * @param {Request} request - 登录请求
 * @returns {Promise<Response>} - 登录响应
 */
async function handleLogin(request) {
  try {
    const formData = await request.formData();
    const username = formData.get('username');
    const password = formData.get('password');
    
    // 验证凭据
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
      // 创建会话
      const sessionId = generateSessionId();
      const sessionData = {
        username: username,
        createdAt: Date.now(),
        expiresAt: Date.now() + (24 * 60 * 60 * 1000) // 24小时
      };
      
      // 将会话存储到KV
      await RENDER_KV.put(`session:${sessionId}`, JSON.stringify(sessionData));
      
      // 设置会话cookie
      const headers = new Headers();
      headers.set('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
      headers.set('Location', '/');
      
      return new Response(null, { status: 302, headers });
    } else {
      return renderLoginPage('用户名或密码无效');
    }
  } catch (error) {
    console.error('登录错误:', error);
    return renderLoginPage('登录过程中发生错误');
  }
}

/**
 * 处理用户登出
 * @param {Request} request - 登出请求
 * @returns {Promise<Response>} - 登出响应
 */
async function handleLogout(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const sessionId = getSessionIdFromCookie(cookieHeader);
  
  if (sessionId) {
    // 从KV移除会话
    await RENDER_KV.delete(`session:${sessionId}`);
  }
  
  // 清除会话cookie
  const headers = new Headers();
  headers.set('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
  headers.set('Location', '/login');
  
  return new Response(null, { status: 302, headers });
}

/**
 * 处理获取服务请求
 * @param {Request} request - 服务请求
 * @returns {Promise<Response>} - 服务响应
 */
async function handleGetServices(request) {
  // 验证会话
  const session = await verifySession(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
  
  try {
    // 从环境解析Render账户
    const accounts = JSON.parse(RENDER_ACCOUNTS);
    const allServices = [];
    
    // 获取每个账户的服务
    for (const account of accounts) {
      const services = await getServicesForAccount(account);
      // 为每个服务添加账户信息
      services.forEach(service => {
        service.accountName = account.name;
        service.accountId = account.id;
        allServices.push(service);
      });
    }
    
    return new Response(JSON.stringify(allServices), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('获取服务出错:', error);
    return new Response(JSON.stringify({ error: '获取服务失败' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * 处理部署请求
 * @param {Request} request - 部署请求
 * @returns {Promise<Response>} - 部署响应
 */
async function handleDeploy(request) {
  // 验证会话
  const session = await verifySession(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
  
  try {
    const { accountId, serviceId } = await request.json();
    
    // 通过ID或名称查找账户（不区分大小写）
    const accounts = JSON.parse(RENDER_ACCOUNTS);
    const account = accounts.find(acc => 
      acc.id === accountId || 
      acc.name.toLowerCase() === accountId.toLowerCase()
    );
    
    if (!account) {
      return new Response(JSON.stringify({ error: '找不到账户' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // 触发部署
    const deployResult = await triggerDeployment(account, serviceId);
    
    return new Response(JSON.stringify(deployResult), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('触发部署出错:', error);
    return new Response(JSON.stringify({ error: '触发部署失败' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * 处理获取环境变量请求
 * @param {Request} request - 环境变量请求
 * @returns {Promise<Response>} - 环境变量响应
 */
async function handleGetEnvVars(request) {
  console.log('调用handleGetEnvVars');
  
  // 验证会话
  const session = await verifySession(request);
  if (!session) {
    console.log('会话验证失败');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
  
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    console.log('路径部分:', pathParts);
    
    const accountNameOrId = pathParts[3];
    const serviceId = pathParts[4];
    
    console.log(`提取的accountNameOrId: ${accountNameOrId}, serviceId: ${serviceId}`);
    
    // 通过ID或名称查找账户（不区分大小写）
    const accounts = JSON.parse(RENDER_ACCOUNTS);
    const account = accounts.find(acc => 
      acc.id === accountNameOrId || 
      acc.name.toLowerCase() === accountNameOrId.toLowerCase()
    );
    
    if (!account) {
      console.log(`找不到账户: ${accountNameOrId}`);
      console.log('可用账户:', accounts.map(a => ({ id: a.id, name: a.name })));
      return new Response(JSON.stringify({ error: '找不到账户' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    console.log(`找到账户: ${account.name} (ID: ${account.id})`);
    
    // 获取环境变量
    const envVars = await getEnvVarsForService(account, serviceId);
    console.log(`获取了 ${envVars.length} 个环境变量`);
    
    return new Response(JSON.stringify(envVars), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('获取环境变量出错:', error);
    return new Response(JSON.stringify({ error: '获取环境变量失败' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * 处理更新所有环境变量请求
 * @param {Request} request - 更新环境变量请求
 * @returns {Promise<Response>} - 更新响应
 */
async function handleUpdateAllEnvVars(request) {
  // 验证会话
  const session = await verifySession(request);
  if (!session) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
  
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const accountNameOrId = pathParts[3];
    const serviceId = pathParts[4];
    const envVars = await request.json();
    
    // 通过ID或名称查找账户（不区分大小写）
    const accounts = JSON.parse(RENDER_ACCOUNTS);
    const account = accounts.find(acc => 
      acc.id === accountNameOrId || 
      acc.name.toLowerCase() === accountNameOrId.toLowerCase()
    );
    
    if (!account) {
      return new Response(JSON.stringify({ error: '找不到账户' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    // 更新所有环境变量
    const result = await updateAllEnvVarsForService(account, serviceId, envVars);
    
    return new Response(JSON.stringify(result), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('更新环境变量出错:', error);
    return new Response(JSON.stringify({ error: '更新环境变量失败' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * 处理更新单个环境变量请求
 * @param {Request} request - 更新单个环境变量请求
 * @returns {Promise<Response>} - 更新响应
 */
async function handleUpdateSingleEnvVar(request) {
  console.log('调用handleUpdateSingleEnvVar');
  
  // 验证会话
  const session = await verifySession(request);
  if (!session) {
    console.log('会话验证失败');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
  
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    console.log('路径部分:', pathParts);
    
    // 路径结构: /api/env-vars/{accountId}/{serviceId}/{envVarKey}
    const accountNameOrId = pathParts[3];
    const serviceId = pathParts[4];
    const envVarKey = pathParts[5];
    
    console.log(`提取的accountNameOrId: ${accountNameOrId}, serviceId: ${serviceId}, envVarKey: ${envVarKey}`);
    
    const { value } = await request.json();
    console.log(`要更新的值: ${value}`);
    
    // 通过ID或名称查找账户（不区分大小写）
    const accounts = JSON.parse(RENDER_ACCOUNTS);
    const account = accounts.find(acc => 
      acc.id === accountNameOrId || 
      acc.name.toLowerCase() === accountNameOrId.toLowerCase()
    );
    
    if (!account) {
      console.log(`找不到账户: ${accountNameOrId}`);
      console.log('可用账户:', accounts.map(a => ({ id: a.id, name: a.name })));
      return new Response(JSON.stringify({ error: '找不到账户' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    console.log(`找到账户: ${account.name} (ID: ${account.id})`);
    
    // 更新单个环境变量
    const result = await updateSingleEnvVarForService(account, serviceId, envVarKey, value);
    console.log('更新结果:', result);
    
    return new Response(JSON.stringify(result), { 
      status: 200, 
      headers: { 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error('更新环境变量出错:', error);
    return new Response(JSON.stringify({ error: '更新环境变量失败' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * 处理删除环境变量请求
 * @param {Request} request - 删除环境变量请求
 * @returns {Promise<Response>} - 删除响应
 */
async function handleDeleteEnvVar(request) {
  console.log('调用handleDeleteEnvVar');
  
  // 验证会话
  const session = await verifySession(request);
  if (!session) {
    console.log('会话验证失败');
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
      status: 401, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
  
  try {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    console.log('路径部分:', pathParts);
    
    // 路径结构: /api/env-vars/{accountId}/{serviceId}/{envVarKey}
    const accountNameOrId = pathParts[3];
    const serviceId = pathParts[4];
    const envVarKey = pathParts[5];
    
    console.log(`提取的accountNameOrId: ${accountNameOrId}, serviceId: ${serviceId}, envVarKey: ${envVarKey}`);
    
    // 通过ID或名称查找账户（不区分大小写）
    const accounts = JSON.parse(RENDER_ACCOUNTS);
    const account = accounts.find(acc => 
      acc.id === accountNameOrId || 
      acc.name.toLowerCase() === accountNameOrId.toLowerCase()
    );
    
    if (!account) {
      console.log(`找不到账户: ${accountNameOrId}`);
      console.log('可用账户:', accounts.map(a => ({ id: a.id, name: a.name })));
      return new Response(JSON.stringify({ error: '找不到账户' }), { 
        status: 404, 
        headers: { 'Content-Type': 'application/json' } 
      });
    }
    
    console.log(`找到账户: ${account.name} (ID: ${account.id})`);
    
    // 删除环境变量
    await deleteEnvVarForService(account, serviceId, envVarKey);
    console.log('环境变量删除成功');
    
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error('删除环境变量出错:', error);
    return new Response(JSON.stringify({ error: '删除环境变量失败' }), { 
      status: 500, 
      headers: { 'Content-Type': 'application/json' } 
    });
  }
}

/**
 * 处理主页请求
 * @param {Request} request - 主页请求
 * @returns {Promise<Response>} - 主页响应
 */
async function handleMainPage(request) {
  // 检查用户是否已登录
  const session = await verifySession(request);
  if (!session) {
    return renderLoginPage();
  }
  
  // 渲染仪表盘
  return renderDashboard();
}

/**
 * 验证用户会话
 * @param {Request} request - 带有会话cookie的请求
 * @returns {Promise<Object|null>} - 会话数据，若无效则为null
 */
async function verifySession(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const sessionId = getSessionIdFromCookie(cookieHeader);
  
  if (!sessionId) {
    return null;
  }
  
  try {
    const sessionData = await RENDER_KV.get(`session:${sessionId}`);
    if (!sessionData) {
      return null;
    }
    
    const session = JSON.parse(sessionData);
    
    // 检查会话是否过期
    if (session.expiresAt < Date.now()) {
      await RENDER_KV.delete(`session:${sessionId}`);
      return null;
    }
    
    return session;
  } catch (error) {
    console.error('会话验证错误:', error);
    return null;
  }
}

/**
 * 从cookie头获取会话ID
 * @param {string} cookieHeader - Cookie头字符串
 * @returns {string|null} - 会话ID，若未找到则为null
 */
function getSessionIdFromCookie(cookieHeader) {
  const cookies = cookieHeader.split(';');
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=');
    if (name === 'session') {
      return value;
    }
  }
  return null;
}

/**
 * 生成随机会话ID
 * @returns {string} - 随机会话ID
 */
function generateSessionId() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 获取特定Render账户的服务
 * @param {Object} account - 账户配置
 * @returns {Promise<Array>} - 服务列表
 */
async function getServicesForAccount(account) {
  // Render API服务终端，包含示例中的查询参数
  const response = await fetch('https://api.render.com/v1/services?includePreviews=true&limit=20', {
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${account.apiKey}`
    }
  });
  
  if (!response.ok) {
    throw new Error(`获取账户 ${account.name} 的服务失败: ${response.statusText}`);
  }
  
  const data = await response.json();
  
  // 根据实际API响应转换服务，仅包含必要信息
  return data.map(item => {
    const service = item.service;
    return {
      id: service.id,
      name: service.name,
      type: service.type,
      autoDeploy: service.autoDeploy,
      autoDeployTrigger: service.autoDeployTrigger,
      createdAt: service.createdAt,
      updatedAt: service.updatedAt,
      suspended: service.suspended,
      dashboardUrl: service.dashboardUrl,
      url: service.serviceDetails.url,
      region: service.serviceDetails.region,
      plan: service.serviceDetails.plan,
      env: service.serviceDetails.env,
      imagePath: service.imagePath,
      ownerId: service.ownerId
    };
  });
}

/**
 * 触发服务部署
 * @param {Object} account - 账户配置
 * @param {string} serviceId - 要部署的服务ID
 * @returns {Promise<Object>} - 部署结果
 */
async function triggerDeployment(account, serviceId) {
  // 用于触发部署的Render API终端，示例中包含请求体
  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${account.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      "clearCache": "do_not_clear"
    })
  });
  
  if (!response.ok) {
    throw new Error(`触发部署失败: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 获取服务的环境变量
 * @param {Object} account - 账户配置
 * @param {string} serviceId - 服务ID
 * @returns {Promise<Array>} - 环境变量列表
 */
async function getEnvVarsForService(account, serviceId) {
  console.log(`获取服务的环境变量: ${serviceId}`);
  
  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=20`, {
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${account.apiKey}`
    }
  });
  
  if (!response.ok) {
    console.error(`获取环境变量失败: ${response.status} ${response.statusText}`);
    throw new Error(`获取环境变量失败: ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log('环境变量响应:', data);
  
  return data;
}

/**
 * 更新服务的所有环境变量
 * @param {Object} account - 账户配置
 * @param {string} serviceId - 服务ID
 * @param {Array} envVars - 环境变量列表
 * @returns {Promise<Array>} - 更新后的环境变量
 */
async function updateAllEnvVarsForService(account, serviceId, envVars) {
  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars`, {
    method: 'PUT',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${account.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(envVars)
  });
  
  if (!response.ok) {
    throw new Error(`更新环境变量失败: ${response.statusText}`);
  }
  
  return await response.json();
}

/**
 * 更新服务的单个环境变量
 * @param {Object} account - 账户配置
 * @param {string} serviceId - 服务ID
 * @param {string} envVarKey - 环境变量键
 * @param {string} value - 环境变量值
 * @returns {Promise<Object>} - 更新后的环境变量
 */
async function updateSingleEnvVarForService(account, serviceId, envVarKey, value) {
  console.log(`更新环境变量: ${envVarKey} = ${value} 用于服务: ${serviceId}`);
  
  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars/${envVarKey}`, {
    method: 'PUT',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${account.apiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      "value": value
    })
  });
  
  if (!response.ok) {
    console.error(`更新环境变量失败: ${response.status} ${response.statusText}`);
    throw new Error(`更新环境变量失败: ${response.statusText}`);
  }
  
  const result = await response.json();
  console.log('更新结果:', result);
  
  return result;
}

/**
 * 删除服务的环境变量
 * @param {Object} account - 账户配置
 * @param {string} serviceId - 服务ID
 * @param {string} envVarKey - 环境变量键
 * @returns {Promise<void>}
 */
async function deleteEnvVarForService(account, serviceId, envVarKey) {
  console.log(`删除环境变量: ${envVarKey} 用于服务: ${serviceId}`);
  
  const response = await fetch(`https://api.render.com/v1/services/${serviceId}/env-vars/${envVarKey}`, {
    method: 'DELETE',
    headers: {
      'accept': 'application/json',
      'authorization': `Bearer ${account.apiKey}`
    }
  });
  
  if (!response.ok) {
    console.error(`删除环境变量失败: ${response.status} ${response.statusText}`);
    throw new Error(`删除环境变量失败: ${response.statusText}`);
  }
  
  console.log('环境变量删除成功');
}

/**
 * 渲染登录页面，设计优化
 * @param {string} error - 要显示的错误信息
 * @returns {Response} - 登录页面HTML响应
 */
function renderLoginPage(error = '') {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Render Service Management - Login</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      justify-content: center;
      align-items: center;
      padding: 20px;
      color: #333;
    }
    
    .login-container {
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(255, 255, 255, 0.2);
      padding: 40px;
      width: 100%;
      max-width: 420px;
      transform: translateY(0);
      transition: all 0.3s ease;
    }
    
    .login-container:hover {
      transform: translateY(-5px);
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255, 255, 255, 0.2);
    }
    
    .logo {
      text-align: center;
      margin-bottom: 30px;
    }
    
    .logo-icon {
      width: 60px;
      height: 60px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 15px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 15px;
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }
    
    .logo-icon svg {
      width: 30px;
      height: 30px;
      fill: white;
    }
    
    h1 {
      font-size: 28px;
      font-weight: 700;
      color: #2d3748;
      text-align: center;
      margin-bottom: 10px;
    }
    
    .subtitle {
      text-align: center;
      color: #718096;
      margin-bottom: 30px;
      font-size: 16px;
    }
    
    .form-group {
      margin-bottom: 25px;
    }
    
    label {
      display: block;
      margin-bottom: 8px;
      font-weight: 600;
      color: #4a5568;
      font-size: 14px;
    }
    
    input {
      width: 100%;
      padding: 15px;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 500;
      transition: all 0.3s ease;
      background-color: #f7fafc;
    }
    
    input:focus {
      outline: none;
      border-color: #667eea;
      background-color: white;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    
    button {
      width: 100%;
      padding: 16px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      margin-top: 10px;
      box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
    }
    
    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 15px 30px rgba(102, 126, 234, 0.4);
    }
    
    button:active {
      transform: translateY(0);
    }
    
    .error-message {
      color: #e53e3e;
      background-color: #fed7d7;
      padding: 12px 16px;
      border-radius: 10px;
      margin-bottom: 20px;
      text-align: center;
      font-size: 14px;
      font-weight: 500;
      animation: shake 0.5s ease-in-out;
    }
    
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
      20%, 40%, 60%, 80% { transform: translateX(5px); }
    }
    
    .footer {
      text-align: center;
      margin-top: 30px;
      color: #a0aec0;
      font-size: 14px;
    }
    
    .footer a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
    }
    
    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo">
      <div class="logo-icon">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 23.15L12 25L16.38 23.15C19.77 20.68 22 16.5 22 12V7L12 2M12 4.18L19.25 7.8V12C19.25 15.58 17.58 18.85 15 20.75V13.25H9V20.75C6.42 18.85 4.75 15.58 4.75 12V7.8L12 4.18Z" />
        </svg>
      </div>
      <h1>Render Manager</h1>
      <p class="subtitle">登录您的账户</p>
    </div>
    
    ${error ? `<div class="error-message">${error}</div>` : ''}
    
    <form method="post" action="/login">
      <div class="form-group">
        <label for="username">用户名</label>
        <input type="text" id="username" name="username" required placeholder="输入您的用户名">
      </div>
      <div class="form-group">
        <label for="password">密码</label>
        <input type="password" id="password" name="password" required placeholder="输入您的密码">
      </div>
      <button type="submit">登录</button>
    </form>
    
    <div class="footer">
      <p>© 2025 Render Service Manager | <a href="https://github.com/ssfun/render-service-manager" target="_blank" rel="noopener noreferrer">@sfun</a></p>
    </div>
  </div>
</body>
</html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}

/**
 * 渲染仪表板页面，布局优化
 * @returns {Response} - 仪表板HTML响应
 */
function renderDashboard() {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Render Service Management</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
      background: #f0f2f5;
      color: #1a202c;
      line-height: 1.6;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    /* 头部样式 */
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 1.5rem 0;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      position: sticky;
      top: 0;
      z-index: 100;
    }
    
    .header-container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 0 2rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .logo {
      display: flex;
      align-items: center;
      gap: 15px;
    }
    
    .logo-icon {
      width: 45px;
      height: 45px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
    }
    
    .logo-icon svg {
      width: 25px;
      height: 25px;
      fill: white;
    }
    
    h1 {
      font-size: 24px;
      font-weight: 700;
    }
    
    .logout-btn {
      padding: 10px 20px;
      background: rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(10px);
      color: white;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 10px;
      cursor: pointer;
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.3s ease;
    }
    
    .logout-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: translateY(-1px);
    }
    
    /* 主容器 */
    .main-content {
      flex: 1;
    }
    
    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 2rem;
    }
    
    /* 统计栏 */
    .stats-bar {
      background: white;
      border-radius: 16px;
      padding: 1.5rem;
      margin-bottom: 2rem;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2rem;
    }
    
    .stats-content {
      display: flex;
      align-items: center;
      gap: 3rem;
      flex: 1;
    }
    
    .stat-item {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .stat-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #667eea20 0%, #764ba220 100%);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #667eea;
    }
    
    .stat-info h3 {
      font-size: 24px;
      font-weight: 700;
      color: #2d3748;
      margin: 0;
    }
    
    .stat-info p {
      font-size: 14px;
      color: #718096;
      margin: 0;
    }
    
    .search-box {
      position: relative;
      width: 300px;
    }
    
    .search-input {
      width: 100%;
      padding: 12px 40px 12px 16px;
      border: 2px solid #e2e8f0;
      border-radius: 12px;
      font-size: 14px;
      transition: all 0.3s ease;
      background-color: #f7fafc;
    }
    
    .search-input:focus {
      outline: none;
      border-color: #667eea;
      background-color: white;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    
    .search-icon {
      position: absolute;
      right: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: #94a3b8;
      pointer-events: none;
    }
    
    /* 服务网格布局 */
    .services-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
      gap: 1.5rem;
    }
    
    /* 增强的服务卡片 */
    .service-card {
      background: white;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      transition: all 0.3s ease;
      border: 1px solid #e2e8f0;
    }
    
    .service-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.08);
    }
    
    .service-card-header {
      background: linear-gradient(135deg, #f7fafc 0%, #edf2f7 100%);
      padding: 1.5rem;
      border-bottom: 1px solid #e2e8f0;
    }
    
    .service-header-top {
      display: flex;
      justify-content: space-between;
      align-items: start;
      margin-bottom: 0.75rem;
    }
    
    .service-name {
      font-size: 18px;
      font-weight: 700;
      color: #1a202c;
      margin: 0;
      line-height: 1.3;
    }
    
    .service-badges {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    
    .service-type {
      padding: 4px 10px;
      background: #e6f3ff;
      color: #2563eb;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .account-badge {
      padding: 4px 10px;
      background: linear-gradient(135deg, #667eea20 0%, #764ba220 100%);
      color: #667eea;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    
    .service-meta {
      display: flex;
      align-items: center;
      gap: 1.5rem;
      font-size: 13px;
      color: #64748b;
    }
    
    .meta-item {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    
    .service-card-body {
      padding: 1.5rem;
    }
    
    .service-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 1.25rem;
    }
    
    .service-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
    }
    
    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }
    
    .status-live {
      background-color: #d1fae5;
      color: #065f46;
    }
    
    .status-live .status-indicator {
      background-color: #10b981;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }
    
    .status-suspended {
      background-color: #fee2e2;
      color: #991b1b;
    }
    
    .status-suspended .status-indicator {
      background-color: #ef4444;
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
    }
    
    .service-url {
      color: #3b82f6;
      text-decoration: none;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 0.25rem;
      transition: color 0.2s ease;
    }
    
    .service-url:hover {
      color: #2563eb;
      text-decoration: underline;
    }
    
    .service-info-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 1rem;
      margin-bottom: 1.5rem;
    }
    
    .info-item {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    
    .info-label {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    
    .info-value {
      font-size: 14px;
      color: #374151;
      font-weight: 500;
    }
    
    .service-actions {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 0.75rem;
    }
    
    .action-btn {
      padding: 10px 12px;
      border: none;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    
    .deploy-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
    }
    
    .deploy-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(102, 126, 234, 0.35);
    }
    
    .env-vars-btn {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
    }
    
    .env-vars-btn:hover {
      background: #e2e8f0;
      color: #334155;
      transform: translateY(-1px);
    }
    
    .events-btn {
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
    }
    
    .events-btn:hover {
      background: #fde68a;
      color: #78350f;
      transform: translateY(-1px);
    }
    
    .action-btn:disabled {
      background: #cbd5e1;
      color: #94a3b8;
      cursor: not-allowed;
      box-shadow: none;
      transform: none;
    }
    
    /* 页脚样式 */
    .footer {
      background: white;
      border-top: 1px solid #e2e8f0;
      padding: 1.5rem 0;
      margin-top: 3rem;
    }
    
    .footer p {
      text-align: center;
      color: #64748b;
      font-size: 14px;
      margin: 0;
    }
    
    .footer a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
    }
    
    .footer a:hover {
      text-decoration: underline;
    }
    
    /* 加载和消息样式 */
    .loading {
      text-align: center;
      padding: 4rem 2rem;
      color: #64748b;
    }
    
    .loading-spinner {
      display: inline-block;
      width: 50px;
      height: 50px;
      border: 4px solid #e2e8f0;
      border-radius: 50%;
      border-top-color: #667eea;
      animation: spin 1s ease-in-out infinite;
      margin-bottom: 1rem;
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    /* 模态框样式 */
    .modal {
      display: none;
      position: fixed;
      z-index: 1000;
      left: 0;
      top: 0;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(8px);
      animation: fadeIn 0.3s ease-out;
    }
    
    .modal.show {
      display: block;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    .modal-content {
      background-color: white;
      margin: 2% auto;
      padding: 0;
      border-radius: 20px;
      width: 95%;
      max-width: 900px;
      max-height: 90vh;
      overflow: hidden;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
      animation: slideUp 0.3s ease-out;
      position: relative;
    }
    
    @keyframes slideUp {
      from {
        transform: translateY(50px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }
    
    .modal-header {
      padding: 2rem 2rem 1rem 2rem;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      position: relative;
    }
    
    .modal-title-section {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    
    .modal-title {
      font-size: 24px;
      font-weight: 700;
      margin: 0;
    }
    
    .modal-service-info {
      margin-top: 0.5rem;
      opacity: 0.9;
      font-size: 14px;
    }
    
    .close-btn {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      color: white;
      font-size: 20px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s ease;
    }
    
    .close-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.1);
    }
    
    .modal-body {
      padding: 2rem;
      max-height: 70vh;
      overflow-y: auto;
    }
    
    /* 事件日志样式 */
    .events-container {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    
    .event-item {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 1rem;
      transition: all 0.3s ease;
    }
    
    .event-item:hover {
      background: white;
      border-color: #cbd5e1;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    
    .event-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 0.75rem;
    }
    
    .event-type {
      font-weight: 700;
      font-size: 14px;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .event-type-badge {
      padding: 4px 10px;
      border-radius: 20px;
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
    }
    
    .event-type-deploy {
      background: #dbeafe;
      color: #1e40af;
    }
    
    .event-type-build {
      background: #fef3c7;
      color: #92400e;
    }
    
    .event-type-error {
      background: #fee2e2;
      color: #991b1b;
    }
    
    .event-time {
      font-size: 12px;
      color: #64748b;
    }
    
    .event-details {
      font-size: 13px;
      color: #475569;
      line-height: 1.5;
    }
    
    .event-status {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 4px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      margin-top: 0.5rem;
    }
    
    .event-status-succeeded {
      background: #d1fae5;
      color: #065f46;
    }
    
    .event-status-failed {
      background: #fee2e2;
      color: #991b1b;
    }
    
    .event-status-started {
      background: #dbeafe;
      color: #1e40af;
    }
    
    /* 环境变量网格布局 */
    .env-vars-container {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    
    .env-var-item {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 0;
      transition: all 0.3s ease;
      overflow: hidden;
    }
    
    .env-var-item:hover {
      background: white;
      border-color: #cbd5e1;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
    }
    
    .env-var-item.editing {
      background: #fef3c7;
      border-color: #f59e0b;
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.1);
    }
    
    .env-var-grid {
      display: grid;
      grid-template-columns: minmax(200px, 1fr) 2fr auto;
      align-items: center;
      padding: 1rem;
      gap: 1rem;
    }
    
    .env-var-key {
      font-weight: 700;
      color: #1e293b;
      font-size: 14px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      background: #e2e8f0;
      padding: 6px 12px;
      border-radius: 6px;
      word-break: break-all;
    }
    
    .env-var-value-wrapper {
      position: relative;
      width: 100%;
    }
    
    .env-var-value {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      color: #475569;
      background: white;
      padding: 10px 40px 10px 12px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      word-break: break-all;
      line-height: 1.5;
      transition: all 0.3s ease;
      width: 100%;
      cursor: pointer;
      position: relative;
    }
    
    .env-var-value.masked {
      color: #94a3b8;
      letter-spacing: 2px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    .env-var-value:hover {
      border-color: #cbd5e1;
      background: #f8fafc;
    }
    
    .visibility-toggle {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255, 255, 255, 0.9);
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      color: #64748b;
    }
    
    .visibility-toggle:hover {
      background: white;
      color: #334155;
      transform: translateY(-50%) scale(1.1);
    }
    
    .env-var-actions {
      display: flex;
      gap: 0.5rem;
    }
    
    .env-var-btn {
      padding: 6px 12px;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    
    .edit-btn {
      background: #3b82f6;
      color: white;
    }
    
    .edit-btn:hover {
      background: #2563eb;
      transform: translateY(-1px);
    }
    
    .delete-btn {
      background: #ef4444;
      color: white;
    }
    
    .delete-btn:hover {
      background: #dc2626;
      transform: translateY(-1px);
    }
    
    .copy-btn {
      background: #10b981;
      color: white;
    }
    
    .copy-btn:hover {
      background: #059669;
      transform: translateY(-1px);
    }
    
    /* 内联编辑器样式 */
    .inline-editor {
      position: relative;
      display: none;
      width: 100%;
    }
    
    .inline-editor.active {
      display: block;
    }
    
    .inline-editor-input {
      width: 100%;
      padding: 10px 12px;
      border: 2px solid #f59e0b;
      border-radius: 8px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      background: white;
      color: #1e293b;
      min-height: 38px;
      resize: vertical;
      transition: all 0.3s ease;
    }
    
    .inline-editor-input:focus {
      outline: none;
      box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.2);
    }
    
    .inline-editor-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.75rem;
      justify-content: flex-end;
    }
    
    .inline-editor-btn {
      padding: 6px 14px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    
    .save-edit-btn {
      background: #10b981;
      color: white;
    }
    
    .save-edit-btn:hover {
      background: #059669;
      transform: translateY(-1px);
    }
    
    .cancel-edit-btn {
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #e2e8f0;
    }
    
    .cancel-edit-btn:hover {
      background: #e2e8f0;
      color: #475569;
    }
    
    /* 添加变量表单 */
    .add-env-var-section {
      margin-top: 2rem;
      padding-top: 2rem;
      border-top: 2px dashed #e2e8f0;
    }
    
    .add-env-var-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }
    
    .add-env-var-title {
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
      margin: 0;
    }
    
    .toggle-form-btn {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      padding: 10px 16px;
      border-radius: 8px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.3s ease;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }
    
    .toggle-form-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 16px rgba(102, 126, 234, 0.3);
    }
    
    .add-env-var-form {
      background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%);
      border: 2px solid #e2e8f0;
      border-radius: 16px;
      padding: 1.5rem;
      transition: all 0.3s ease;
      transform: translateY(-10px);
      opacity: 0;
      max-height: 0;
      overflow: hidden;
    }
    
    .add-env-var-form.show {
      transform: translateY(0);
      opacity: 1;
      max-height: 300px;
    }
    
    .form-row {
      display: grid;
      grid-template-columns: 1fr 2fr;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .form-label {
      font-weight: 700;
      color: #374151;
      font-size: 14px;
    }
    
    .form-input {
      padding: 10px 12px;
      border: 2px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      transition: all 0.3s ease;
      background-color: white;
    }
    
    .form-input:focus {
      outline: none;
      border-color: #667eea;
      box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
    }
    
    .form-input.key-input {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
    }
    
    /* 通知样式 */
    .notification {
      position: fixed;
      top: 80px;
      right: 20px;
      background: white;
      border-radius: 12px;
      padding: 1rem 1.25rem;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
      border-left: 4px solid #10b981;
      z-index: 2000;
      animation: slideInRight 0.3s ease-out;
      max-width: 400px;
    }
    
    @keyframes slideInRight {
      from {
        transform: translateX(100%);
        opacity: 0;
      }
      to {
        transform: translateX(0);
        opacity: 1;
      }
    }
    
    .notification.error {
      border-left-color: #ef4444;
    }
    
    .notification.success {
      border-left-color: #10b981;
    }
    
    .notification-content {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }
    
    .notification-icon {
      width: 20px;
      height: 20px;
      flex-shrink: 0;
    }
    
    .notification-text {
      font-size: 14px;
      font-weight: 500;
      color: #374151;
    }
    
    /* 空状态 */
    .empty-state {
      text-align: center;
      padding: 3rem 2rem;
      color: #94a3b8;
    }
    
    .empty-state-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 1rem auto;
      opacity: 0.5;
    }
    
    .empty-state h3 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 0.5rem;
      color: #64748b;
    }
    
    /* 响应式设计 */
    @media (max-width: 768px) {
      .header-container {
        flex-direction: column;
        gap: 1rem;
        text-align: center;
      }
      
      .stats-bar {
        flex-direction: column;
      }
      
      .stats-content {
        flex-direction: column;
        gap: 1.5rem;
      }
      
      .search-box {
        width: 100%;
      }
      
      .services-grid {
        grid-template-columns: 1fr;
      }
      
      .service-info-grid {
        grid-template-columns: 1fr;
      }
      
      .service-actions {
        grid-template-columns: 1fr;
      }
      
      .env-var-grid {
        grid-template-columns: 1fr;
        gap: 0.75rem;
      }
      
      .env-var-actions {
        margin-top: 0.75rem;
        justify-content: flex-start;
      }
      
      .form-row {
        grid-template-columns: 1fr;
      }
    }
    
    /* 自定义滚动条 */
    .modal-body::-webkit-scrollbar {
      width: 6px;
    }
    
    .modal-body::-webkit-scrollbar-track {
      background: #f1f5f9;
      border-radius: 3px;
    }
    
    .modal-body::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 3px;
    }
    
    .modal-body::-webkit-scrollbar-thumb:hover {
      background: #94a3b8;
    }
  </style>
</head>
<body>
  <header class="header">
    <div class="header-container">
      <div class="logo">
        <div class="logo-icon">
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7V12C2 16.5 4.23 20.68 7.62 23.15L12 25L16.38 23.15C19.77 20.68 22 16.5 22 12V7L12 2M12 4.18L19.25 7.8V12C19.25 15.58 17.58 18.85 15 20.75V13.25H9V20.75C6.42 18.85 4.75 15.58 4.75 12V7.8L12 4.18Z" />
          </svg>
        </div>
        <h1>Render Service Manager</h1>
      </div>
      <a href="/logout" class="logout-btn">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M17 7L15.59 8.41L18.17 11H8V13H18.17L15.59 15.58L17 17L22 12L17 7Z" fill="currentColor"/>
          <path d="M4 5H12V3H4C2.9 3 2 3.9 2 5V19C2 20.1 2.9 21 4 21H12V19H4V5Z" fill="currentColor"/>
        </svg>
        登出
      </a>
    </div>
  </header>

  <div class="main-content">
    <div class="container">
      <!-- 统计栏 -->
      <div class="stats-bar">
        <div class="stats-content">
          <div class="stat-item">
            <div class="stat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M21 8V20.993A1 1 0 0 1 20.007 22H3.993A.993.993 0 0 1 3 21.008V2.992C3 2.455 3.449 2 4.002 2h10.995L21 8zm-2 1h-5V4H5v16h14V9zM8 7h3v2H8V7zm0 4h8v2H8v-2zm0 4h8v2H8v-2z" fill="currentColor"/>
              </svg>
            </div>
            <div class="stat-info">
              <h3 id="totalServices">0</h3>
              <p>总服务数</p>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
              </svg>
            </div>
            <div class="stat-info">
              <h3 id="liveServices">0</h3>
              <p>运行中服务</p>
            </div>
          </div>
          <div class="stat-item">
            <div class="stat-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z" fill="currentColor"/>
              </svg>
            </div>
            <div class="stat-info">
              <h3 id="totalAccounts">0</h3>
              <p>账户数</p>
            </div>
          </div>
        </div>
        <div class="search-box">
          <input 
            type="text" 
            id="serviceSearch" 
            class="search-input" 
            placeholder="搜索服务..."
            onkeyup="filterServices()"
          >
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M21 21L16.514 16.506L21 21ZM19 10.5C19 15.194 15.194 19 10.5 19C5.806 19 2 15.194 2 10.5C2 5.806 5.806 2 10.5 2C15.194 2 19 5.806 19 10.5Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
      
      <div id="loading" class="loading">
        <div class="loading-spinner"></div>
        <p>加载服务中...</p>
      </div>
      
      <div id="services-container" class="services-grid" style="display: none;">
        <!-- 服务将在这里动态加载 -->
      </div>
    </div>
  </div>

  <footer class="footer">
    <p>© 2025 Render Service Manager | <a href="https://github.com/ssfun/render-service-manager" target="_blank" rel="noopener noreferrer">@sfun</a></p>
  </footer>

  <!-- 环境变量模态框 -->
  <div id="envVarsModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <div class="modal-title-section">
            <h2 class="modal-title">环境变量</h2>
            <button class="close-btn" onclick="closeEnvVarsModal()">×</button>
          </div>
          <div class="modal-service-info" id="modalServiceInfo">
            <!-- 服务信息将在这里插入 -->
          </div>
        </div>
      </div>
      <div class="modal-body">
        <div id="envVarsContainer" class="env-vars-container">
          <!-- 环境变量将在这里加载 -->
        </div>

        <!-- 添加新环境变量部分 -->
        <div class="add-env-var-section">
          <div class="add-env-var-header">
            <h3 class="add-env-var-title">添加新变量</h3>
            <button class="toggle-form-btn" onclick="toggleAddForm()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span id="toggleFormText">添加变量</span>
            </button>
          </div>
          <div class="add-env-var-form" id="addEnvVarForm">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">键</label>
                <input 
                  type="text" 
                  id="newEnvVarKey" 
                  class="form-input key-input" 
                  placeholder="VARIABLE_NAME"
                  onkeydown="handleFormKeyDown(event)"
                >
              </div>
              <div class="form-group">
                <label class="form-label">值</label>
                <input 
                  type="text" 
                  id="newEnvVarValue" 
                  class="form-input" 
                  placeholder="variable_value"
                  onkeydown="handleFormKeyDown(event)"
                >
              </div>
            </div>
            <div class="form-actions" style="display: flex; gap: 0.75rem; justify-content: flex-end;">
              <button class="inline-editor-btn cancel-edit-btn" onclick="toggleAddForm()">
                取消
              </button>
              <button class="inline-editor-btn save-edit-btn" onclick="addEnvVar()">
                保存变量
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 事件日志模态框 -->
  <div id="eventsModal" class="modal">
    <div class="modal-content">
      <div class="modal-header">
        <div>
          <div class="modal-title-section">
            <h2 class="modal-title">事件日志</h2>
            <button class="close-btn" onclick="closeEventsModal()">×</button>
          </div>
          <div class="modal-service-info" id="eventsModalServiceInfo">
            <!-- 服务信息将在这里插入 -->
          </div>
        </div>
      </div>
      <div class="modal-body">
        <div id="eventsContainer" class="events-container">
          <!-- 事件日志将在这里加载 -->
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentAccountName = ''
    let currentServiceId = ''
    let currentAccountId = ''
    let currentServiceName = ''
    let allEnvVars = []
    let allServices = []
    let isFormVisible = false
    let editingKey = null

    // 从API获取服务
    async function fetchServices() {
      try {
        const response = await fetch('/api/services');
        if (!response.ok) {
          throw new Error('获取服务失败');
        }
        
        allServices = await response.json();
        renderServices(allServices);
        updateStats();
        
        // 修复：直接使用style.display而不是依赖hidden类
        document.getElementById('loading').style.display = 'none';
        document.getElementById('services-container').style.display = 'grid';
      } catch (error) {
        console.error('获取服务出错:', error);
        document.getElementById('loading').style.display = 'none';
        showNotification('加载服务出错: ' + error.message, 'error');
      }
    }
    
    // 在UI中渲染服务
    function renderServices(services) {
      const container = document.getElementById('services-container');
      container.innerHTML = '';
      
      if (services.length === 0) {
        container.innerHTML = \`
          <div class="empty-state" style="grid-column: 1 / -1;">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3>未找到服务</h3>
            <p>您的Render账户中没有配置任何服务。</p>
          </div>
        \`;
        return;
      }
      
      services.forEach(service => {
        const serviceCard = createServiceCard(service);
        container.appendChild(serviceCard);
      });
    }
    
    // 创建服务卡片元素
    function createServiceCard(service) {
      const card = document.createElement('div');
      card.className = 'service-card';
      card.setAttribute('data-name', service.name.toLowerCase());
      card.setAttribute('data-account', service.accountName.toLowerCase());
      
      // 根据suspended字段确定状态类
      let statusClass = 'status-live';
      let statusText = '运行中';
      
      if (service.suspended === 'suspended') {
        statusClass = 'status-suspended';
        statusText = '已暂停';
      }
      
      // 格式化日期
      const updatedDate = new Date(service.updatedAt).toLocaleDateString();
      
      card.innerHTML = \`
        <div class="service-card-header">
          <div class="service-header-top">
            <h3 class="service-name">\${service.name}</h3>
            <div class="service-badges">
              <span class="service-type">\${service.type}</span>
              <span class="account-badge">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 4C14.21 4 16 5.79 16 8C16 10.21 14.21 12 12 12C9.79 12 8 10.21 8 8C8 5.79 9.79 4 12 4M12 14C16.42 14 20 15.79 20 18V20H4V18C4 15.79 7.58 14 12 14Z" fill="currentColor"/>
                </svg>
                \${service.accountName}
              </span>
            </div>
          </div>
          <div class="service-meta">
            <div class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C6.48 2 2 6.48 2 12S6.48 22 12 22 22 17.52 22 12 17.52 2 12 2ZM16.2 16.2L11 13V7H12.5V12.2L17 14.9L16.2 16.2Z" fill="currentColor"/>
              </svg>
              更新于 \${updatedDate}
            </div>
            <div class="meta-item">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2C15.31 2 18 4.66 18 7.95C18 12.41 12 19 12 19S6 12.41 6 7.95C6 4.66 8.69 2 12 2M12 6C10.9 6 10 6.9 10 8C10 9.1 10.9 10 12 10C13.1 10 14 9.1 14 8C14 6.9 13.1 6 12 6Z" fill="currentColor"/>
              </svg>
              \${service.region}
            </div>
          </div>
        </div>
        <div class="service-card-body">
          <div class="service-status-row">
            <div class="service-status \${statusClass}">
              <div class="status-indicator"></div>
              \${statusText}
            </div>
            <a href="\${service.url}" target="_blank" class="service-url">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 13V19C18 20.1 17.1 21 16 21H5C3.9 21 3 20.1 3 19V8C3 6.9 3.9 6 5 6H11M15 3H21M21 3V9M21 3L10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              访问服务
            </a>
          </div>
          <div class="service-info-grid">
            <div class="info-item">
              <span class="info-label">套餐</span>
              <span class="info-value">\${service.plan}</span>
            </div>
            <div class="info-item">
              <span class="info-label">环境</span>
              <span class="info-value">\${service.env}</span>
            </div>
            <div class="info-item">
              <span class="info-label">自动部署</span>
              <span class="info-value">\${service.autoDeploy === 'yes' ? '已启用' : '已禁用'}</span>
            </div>
            <div class="info-item">
              <span class="info-label">服务ID</span>
              <span class="info-value" style="font-size: 12px; font-family: monospace;">\${service.id}</span>
            </div>
          </div>
          <div class="service-actions">
            <button class="action-btn deploy-btn" onclick="deployService('\${service.accountName}', '\${service.id}', '\${service.name}')" \${service.suspended === 'suspended' ? 'disabled' : ''}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L13.09 8.26L18 7L16.74 12L22 13.09L15.74 14L17 19L12 17.74L7 19L8.26 14L2 13.09L8.26 12L7 7L12 8.26V2Z" fill="white"/>
              </svg>
              部署
            </button>
            <button class="action-btn env-vars-btn" onclick="openEnvVarsModal('\${service.accountName}', '\${service.id}', '\${service.name}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 6H2V20C2 21.1 2.9 22 4 22H18V20H4V6ZM20 2H8C6.9 2 6 2.9 6 4V16C6 17.1 6.9 18 8 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2ZM19 11H15V15H13V11H9V9H13V5H15V9H19V11Z" fill="currentColor"/>
              </svg>
              环境变量
            </button>
            <button class="action-btn events-btn" onclick="openEventsModal('\${service.accountName}', '\${service.id}', '\${service.name}')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 8V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              事件日志
            </button>
          </div>
        </div>
      \`;
      
      return card;
    }
    
    // 更新统计信息
    function updateStats() {
      const totalServices = allServices.length;
      const liveServices = allServices.filter(s => s.suspended !== 'suspended').length;
      const accounts = [...new Set(allServices.map(s => s.accountName))];
      
      document.getElementById('totalServices').textContent = totalServices;
      document.getElementById('liveServices').textContent = liveServices;
      document.getElementById('totalAccounts').textContent = accounts.length;
    }
    
    // 根据搜索过滤服务
    function filterServices() {
      const searchTerm = document.getElementById('serviceSearch').value.toLowerCase();
      const serviceCards = document.querySelectorAll('.service-card');
      
      serviceCards.forEach(card => {
        const name = card.getAttribute('data-name');
        const account = card.getAttribute('data-account');
        
        if (name.includes(searchTerm) || account.includes(searchTerm)) {
          card.style.display = 'block';
        } else {
          card.style.display = 'none';
        }
      });
    }
    
    // 部署服务
    async function deployService(accountName, serviceId, serviceName) {
      if (!confirm(\`确定要部署 \${serviceName}?\`)) {
        return;
      }
      
      const accountId = accountName.toLowerCase().replace(/\\s+/g, '-');
      
      try {
        const response = await fetch('/api/deploy', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            accountId: accountId,
            serviceId: serviceId
          })
        });
        
        if (!response.ok) {
          throw new Error('部署服务失败');
        }
        
        const result = await response.json();
        showNotification(\`已成功触发 \${serviceName} 的部署。部署ID: \${result.id}\`, 'success');
        
        setTimeout(fetchServices, 2000);
      } catch (error) {
        console.error('部署服务出错:', error);
        showNotification('部署服务出错: ' + error.message, 'error');
      }
    }
    
    // 打开事件日志模态框
    async function openEventsModal(accountName, serviceId, serviceName) {
      const modal = document.getElementById('eventsModal');
      const container = document.getElementById('eventsContainer');
      const serviceInfo = document.getElementById('eventsModalServiceInfo');
      
      const accountId = accountName.toLowerCase().replace(/\\s+/g, '-');
      
      serviceInfo.innerHTML = \`查看 <strong>\${serviceName}</strong> (\${accountName}) 的最近事件\`;
      
      container.innerHTML = '<div class="loading" style="padding: 2rem;"><div class="loading-spinner"></div><p>加载事件日志中...</p></div>';
      
      modal.classList.add('show');
      
      try {
        const response = await fetch(\`/api/events/\${accountId}/\${serviceId}\`);
        
        if (!response.ok) {
          throw new Error(\`获取事件日志失败: \${response.status} \${response.statusText}\`);
        }
        
        const events = await response.json();
        renderEvents(events);
      } catch (error) {
        console.error('获取事件日志出错:', error);
        container.innerHTML = \`
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3>加载事件日志出错</h3>
            <p>\${error.message}</p>
          </div>
        \`;
      }
    }
    
    // 渲染事件日志
    function renderEvents(events) {
      const container = document.getElementById('eventsContainer');
      
      if (events.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 8V12L15 15M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3>没有事件日志</h3>
            <p>此服务暂无事件记录。</p>
          </div>
        \`;
        return;
      }
      
      container.innerHTML = '';
      
      events.forEach(item => {
        const event = item.event;
        const eventItem = document.createElement('div');
        eventItem.className = 'event-item';
        
        // 格式化时间
        const eventTime = new Date(event.timestamp).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
        
        // 解析事件类型和状态
        let eventTypeText = event.type.replace(/_/g, ' ').toUpperCase();
        let eventTypeBadgeClass = 'event-type-deploy';
        let statusHtml = '';
        
        if (event.type.includes('deploy')) {
          eventTypeBadgeClass = 'event-type-deploy';
          
          if (event.details && event.details.deployStatus) {
            const status = event.details.deployStatus;
            let statusClass = 'event-status-started';
            let statusText = status.toUpperCase();
            
            if (status === 'succeeded') {
              statusClass = 'event-status-succeeded';
              statusText = '成功';
            } else if (status === 'failed') {
              statusClass = 'event-status-failed';
              statusText = '失败';
            } else if (status === 'started') {
              statusClass = 'event-status-started';
              statusText = '开始';
            }
            
            statusHtml = \`<div class="event-status \${statusClass}">\${statusText}</div>\`;
          }
        } else if (event.type.includes('build')) {
          eventTypeBadgeClass = 'event-type-build';
        } else if (event.type.includes('error') || event.type.includes('fail')) {
          eventTypeBadgeClass = 'event-type-error';
        }
        
        // 构建触发信息
        let triggerInfo = '';
        if (event.details && event.details.trigger) {
          const trigger = event.details.trigger;
          const triggerParts = [];
          
          if (trigger.manual) {
            triggerParts.push('手动部署');
          }
          if (trigger.envUpdated) {
            triggerParts.push('环境变量更新');
          }
          if (trigger.rollback) {
            triggerParts.push('回滚');
          }
          if (trigger.user && trigger.user.email) {
            triggerParts.push(\`用户: \${trigger.user.email}\`);
          }
          
          if (triggerParts.length > 0) {
            triggerInfo = \`<div style="margin-top: 0.5rem; font-size: 12px; color: #64748b;">触发: \${triggerParts.join(', ')}</div>\`;
          }
        }
        
        // 构建失败原因
        let failureReason = '';
        if (event.details && event.details.reason && event.details.reason.failure) {
          const failure = event.details.reason.failure;
          if (failure.nonZeroExit) {
            failureReason = \`<div style="margin-top: 0.5rem; font-size: 12px; color: #ef4444;">失败原因: 非零退出码 (\${failure.nonZeroExit})</div>\`;
          } else if (failure.evicted) {
            failureReason = \`<div style="margin-top: 0.5rem; font-size: 12px; color: #ef4444;">失败原因: 资源不足</div>\`;
          }
        }
        
        eventItem.innerHTML = \`
          <div class="event-header">
            <div class="event-type">
              <span class="event-type-badge \${eventTypeBadgeClass}">\${eventTypeText}</span>
              \${statusHtml}
            </div>
            <div class="event-time">\${eventTime}</div>
          </div>
          <div class="event-details">
            <div>事件ID: \${event.id}</div>
            \${event.details && event.details.deployId ? \`<div>部署ID: \${event.details.deployId}</div>\` : ''}
            \${triggerInfo}
            \${failureReason}
          </div>
        \`;
        
        container.appendChild(eventItem);
      });
    }
    
    // 关闭事件日志模态框
    function closeEventsModal() {
      const modal = document.getElementById('eventsModal');
      modal.classList.remove('show');
    }
    
    // 打开环境变量模态框
    async function openEnvVarsModal(accountName, serviceId, serviceName) {
      currentAccountName = accountName;
      currentServiceId = serviceId;
      currentServiceName = serviceName;
      currentAccountId = accountName.toLowerCase().replace(/\\s+/g, '-');
      
      const modal = document.getElementById('envVarsModal');
      const container = document.getElementById('envVarsContainer');
      const serviceInfo = document.getElementById('modalServiceInfo');
      
      serviceInfo.innerHTML = \`管理 <strong>\${serviceName}</strong> (\${accountName}) 的变量\`;
      
      container.innerHTML = '<div class="loading" style="padding: 2rem;"><div class="loading-spinner"></div><p>加载环境变量中...</p></div>';
      resetAddForm();
      
      modal.classList.add('show');
      
      try {
        const response = await fetch(\`/api/env-vars/\${currentAccountId}/\${currentServiceId}\`);
        
        if (!response.ok) {
          throw new Error(\`获取环境变量失败: \${response.status} \${response.statusText}\`);
        }
        
        const envVars = await response.json();
        allEnvVars = envVars;
        renderEnvVars(envVars);
      } catch (error) {
        console.error('获取环境变量出错:', error);
        container.innerHTML = \`
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3>加载变量出错</h3>
            <p>\${error.message}</p>
          </div>
        \`;
      }
    }
    
    // 使用网格布局渲染环境变量
    function renderEnvVars(envVars) {
      const container = document.getElementById('envVarsContainer');
      
      if (envVars.length === 0) {
        container.innerHTML = \`
          <div class="empty-state">
            <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M20 7L12 3L4 7M20 7L12 11M20 7V17L12 21M12 11L4 7M12 11V21M4 7V17L12 21" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <h3>没有环境变量</h3>
            <p>此服务尚未设置任何环境变量。<br>点击"添加变量"创建您的第一个环境变量。</p>
          </div>
        \`;
        return;
      }
      
      container.innerHTML = '';
      
      envVars.forEach(item => {
        const envVar = item.envVar;
        const envVarItem = document.createElement('div');
        envVarItem.className = 'env-var-item';
        envVarItem.id = \`env-var-\${envVar.key}\`;
        
        envVarItem.innerHTML = \`
          <div class="env-var-grid">
            <div class="env-var-key">\${envVar.key}</div>
            <div class="env-var-value-wrapper">
              <div class="env-var-value masked" id="value-\${envVar.key}" onclick="startInlineEdit('\${envVar.key}')" title="点击编辑">••••••••••••••••</div>
              <button class="visibility-toggle" onclick="toggleValueVisibility('\${envVar.key}')" title="切换可见性">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 12S5 4 12 4S23 12 23 12S19 20 12 20S1 12 1 12Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
              <div class="inline-editor" id="editor-\${envVar.key}">
                <textarea class="inline-editor-input" id="input-\${envVar.key}" onkeydown="handleEditorKeyDown(event, '\${envVar.key}')">\${envVar.value}</textarea>
                <div class="inline-editor-actions">
                  <button class="inline-editor-btn cancel-edit-btn" onclick="cancelInlineEdit('\${envVar.key}')">
                    取消
                  </button>
                  <button class="inline-editor-btn save-edit-btn" onclick="saveInlineEdit('\${envVar.key}')">
                    保存
                  </button>
                </div>
              </div>
            </div>
            <div class="env-var-actions">
              <button class="env-var-btn copy-btn" onclick="copyValue('\${envVar.key}', '\${escapeHtml(envVar.value)}')" title="复制值">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M20 9H11C9.89543 9 9 9.89543 9 11V20C9 21.1046 9.89543 22 11 22H20C21.1046 22 22 21.1046 22 20V11C22 9.89543 21.1046 9 20 9Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M5 15H4C2.89543 15 2 14.1046 2 13V4C2 2.89543 2.89543 2 4 2H13C14.1046 2 15 2.89543 15 4V5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                复制
              </button>
              <button class="env-var-btn edit-btn" onclick="startInlineEdit('\${envVar.key}')" title="编辑变量">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M11 4H4C2.89543 4 2 4.89543 2 6V20C2 21.1046 2.89543 22 4 22H18C19.1046 22 20 21.1046 20 20V13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M18.5 2.50023C18.8978 2.1024 19.4374 1.87891 20 1.87891C20.5626 1.87891 21.1022 2.1024 21.5 2.50023C21.8978 2.89805 22.1213 3.43762 22.1213 4.00023C22.1213 4.56284 21.8978 5.1024 21.5 5.50023L12 15.0002L8 16.0002L9 12.0002L18.5 2.50023Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                编辑
              </button>
              <button class="env-var-btn delete-btn" onclick="deleteEnvVar('\${envVar.key}')" title="删除变量">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 6H5H21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  <path d="M8 6V4C8 2.89543 8.89543 2 10 2H14C15.1046 2 16 2.89543 16 4V6M19 6V20C19 21.1046 18.1046 22 17 22H7C5.89543 22 5 21.1046 5 20V6H19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                删除
              </button>
            </div>
          </div>
        \`;
        
        container.appendChild(envVarItem);
      });
    }
    
    // 切换值的可见性
    function toggleValueVisibility(key) {
      const valueElement = document.getElementById(\`value-\${key}\`);
      const isCurrentlyMasked = valueElement.classList.contains('masked');
      
      if (isCurrentlyMasked) {
        const envVar = allEnvVars.find(item => item.envVar.key === key);
        if (envVar) {
          valueElement.textContent = envVar.envVar.value;
          valueElement.classList.remove('masked');
        }
      } else {
        valueElement.textContent = '••••••••••••••••';
        valueElement.classList.add('masked');
      }
    }
    
    // 开始内联编辑
    function startInlineEdit(key) {
      if (editingKey && editingKey !== key) {
        cancelInlineEdit(editingKey);
      }
      
      editingKey = key;
      const item = document.getElementById(\`env-var-\${key}\`);
      const valueWrapper = item.querySelector('.env-var-value-wrapper');
      const valueDiv = document.getElementById(\`value-\${key}\`);
      const editor = document.getElementById(\`editor-\${key}\`);
      const input = document.getElementById(\`input-\${key}\`);
      const visibilityToggle = valueWrapper.querySelector('.visibility-toggle');
      
      item.classList.add('editing');
      
      valueDiv.style.display = 'none';
      visibilityToggle.style.display = 'none';
      editor.classList.add('active');
      
      input.focus();
      input.select();
      
      autoResizeTextarea(input);
    }
    
    // 取消内联编辑
    function cancelInlineEdit(key) {
      editingKey = null;
      const item = document.getElementById(\`env-var-\${key}\`);
      const valueWrapper = item.querySelector('.env-var-value-wrapper');
      const valueDiv = document.getElementById(\`value-\${key}\`);
      const editor = document.getElementById(\`editor-\${key}\`);
      const input = document.getElementById(\`input-\${key}\`);
      const visibilityToggle = valueWrapper.querySelector('.visibility-toggle');
      
      item.classList.remove('editing');
      
      const originalValue = allEnvVars.find(item => item.envVar.key === key)?.envVar.value || '';
      input.value = originalValue;
      
      valueDiv.style.display = 'block';
      visibilityToggle.style.display = 'flex';
      editor.classList.remove('active');
      
      // 恢复遮罩状态
      if (valueDiv.classList.contains('masked')) {
        valueDiv.textContent = '••••••••••••••••';
      }
    }
    
    // 保存内联编辑
    async function saveInlineEdit(key) {
      const input = document.getElementById(\`input-\${key}\`);
      const newValue = input.value.trim();
      
      if (newValue === '') {
        showNotification('值不能为空。', 'error');
        return;
      }
      
      const originalValue = allEnvVars.find(item => item.envVar.key === key)?.envVar.value || '';
      if (newValue === originalValue) {
        cancelInlineEdit(key);
        return;
      }
      
      try {
        const response = await fetch(\`/api/env-vars/\${currentAccountId}/\${currentServiceId}/\${encodeURIComponent(key)}\`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            value: newValue
          })
        });
        
        if (!response.ok) {
          throw new Error('更新环境变量失败');
        }
        
        const envVarIndex = allEnvVars.findIndex(item => item.envVar.key === key);
        if (envVarIndex !== -1) {
          allEnvVars[envVarIndex].envVar.value = newValue;
        }
        
        const valueDiv = document.getElementById(\`value-\${key}\`);
        valueDiv.textContent = '••••••••••••••••';
        valueDiv.classList.add('masked');
        
        cancelInlineEdit(key);
        
        showNotification(\`环境变量 '\${key}' 更新成功。\`, 'success');
        
      } catch (error) {
        console.error('更新环境变量出错:', error);
        showNotification('更新环境变量出错: ' + error.message, 'error');
      }
    }
    
    // 删除环境变量
    async function deleteEnvVar(key) {
      if (!confirm(\`确定要删除环境变量 '\${key}'?\\n\\n此操作无法撤销。\`)) {
        return;
      }
      
      try {
        const response = await fetch(\`/api/env-vars/\${currentAccountId}/\${currentServiceId}/\${encodeURIComponent(key)}\`, {
          method: 'DELETE'
        });
        
        if (!response.ok) {
          throw new Error('删除环境变量失败');
        }
        
        allEnvVars = allEnvVars.filter(item => item.envVar.key !== key);
        renderEnvVars(allEnvVars);
        
        showNotification(\`环境变量 '\${key}' 删除成功。\`, 'success');
        
      } catch (error) {
        console.error('删除环境变量出错:', error);
        showNotification('删除环境变量出错: ' + error.message, 'error');
      }
    }
    
    // 复制值到剪贴板
    async function copyValue(key, value) {
      try {
        await navigator.clipboard.writeText(value);
        showNotification(\`已复制 \${key} 的值到剪贴板\`, 'success');
      } catch (err) {
        console.error('复制失败: ', err);
        const textArea = document.createElement('textarea');
        textArea.value = value;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification(\`已复制 \${key} 的值到剪贴板\`, 'success');
      }
    }
    
    // 显示通知
    function showNotification(message, type = 'success') {
      const existingNotifications = document.querySelectorAll('.notification');
      existingNotifications.forEach(notification => notification.remove());
      
      const notification = document.createElement('div');
      notification.className = \`notification \${type}\`;
      
      const icon = type === 'success' 
        ? '<svg class="notification-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9 16.17L4.83 12L3.41 13.41L9 19L21 7L19.59 5.59L9 16.17Z" fill="#10b981"/></svg>'
        : '<svg class="notification-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM13 17H11V15H13V17ZM13 13H11V7H13V13Z" fill="#ef4444"/></svg>';
      
      notification.innerHTML = \`
        <div class="notification-content">
          \${icon}
          <div class="notification-text">\${message}</div>
        </div>
      \`;
      
      document.body.appendChild(notification);
      
      setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s ease-out reverse';
        setTimeout(() => notification.remove(), 300);
      }, 4000);
    }
    
    // 切换添加表单可见性
    function toggleAddForm() {
      const form = document.getElementById('addEnvVarForm');
      const toggleText = document.getElementById('toggleFormText');
      
      isFormVisible = !isFormVisible;
      
      if (isFormVisible) {
        form.classList.add('show');
        toggleText.textContent = '取消';
        setTimeout(() => {
          document.getElementById('newEnvVarKey').focus();
        }, 300);
      } else {
        form.classList.remove('show');
        toggleText.textContent = '添加变量';
        resetAddForm();
      }
    }
    
    // 重置添加表单
    function resetAddForm() {
      document.getElementById('newEnvVarKey').value = '';
      document.getElementById('newEnvVarValue').value = '';
      isFormVisible = false;
      const form = document.getElementById('addEnvVarForm');
      const toggleText = document.getElementById('toggleFormText');
      form.classList.remove('show');
      toggleText.textContent = '添加变量';
    }
    
    // 处理表单中的键盘快捷键
    function handleFormKeyDown(event) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        addEnvVar();
      } else if (event.key === 'Escape') {
        toggleAddForm();
      }
    }
    
    // 处理编辑器中的键盘快捷键
    function handleEditorKeyDown(event, key) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        saveInlineEdit(key);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cancelInlineEdit(key);
      }
      
      setTimeout(() => autoResizeTextarea(event.target), 0);
    }
    
    // 自动调整文本区域大小
    function autoResizeTextarea(textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = Math.max(38, textarea.scrollHeight) + 'px';
    }
    
    // 添加环境变量
    async function addEnvVar() {
      const key = document.getElementById('newEnvVarKey').value.trim();
      const value = document.getElementById('newEnvVarValue').value.trim();
      
      if (!key || !value) {
        showNotification('请输入环境变量的键和值。', 'error');
        return;
      }
      
      const existingVar = allEnvVars.find(item => item.envVar.key === key);
      if (existingVar) {
        if (!confirm(\`环境变量 '\${key}' 已存在。是否要更新它？\`)) {
          return;
        }
      }
      
      try {
        const response = await fetch(\`/api/env-vars/\${currentAccountId}/\${currentServiceId}/\${encodeURIComponent(key)}\`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            value: value
          })
        });
        
        if (!response.ok) {
          throw new Error('添加环境变量失败');
        }
        
        const envVarsResponse = await fetch(\`/api/env-vars/\${currentAccountId}/\${currentServiceId}\`);
        const envVars = await envVarsResponse.json();
        allEnvVars = envVars;
        renderEnvVars(envVars);
        
        resetAddForm();
        
        showNotification(\`环境变量 '\${key}' \${existingVar ? '更新' : '添加'}成功。\`, 'success');
        
      } catch (error) {
        console.error('添加环境变量出错:', error);
        showNotification('添加环境变量出错: ' + error.message, 'error');
      }
    }
    
    // 关闭环境变量模态框
    function closeEnvVarsModal() {
      if (editingKey) {
        cancelInlineEdit(editingKey);
      }
      
      const modal = document.getElementById('envVarsModal');
      modal.classList.remove('show');
      
      resetAddForm();
      
      currentAccountName = '';
      currentServiceId = '';
      currentAccountId = '';
      currentServiceName = '';
      allEnvVars = [];
    }
    
    // 转义HTML的工具函数
    function escapeHtml(text) {
      const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      };
      return text.replace(/[&<>"']/g, function(m) { return map[m]; });
    }
    
    // 处理模态框外的点击
    window.onclick = function(event) {
      const envVarsModal = document.getElementById('envVarsModal');
      const eventsModal = document.getElementById('eventsModal');
      
      if (event.target === envVarsModal) {
        closeEnvVarsModal();
      } else if (event.target === eventsModal) {
        closeEventsModal();
      }
    }
    
    // 处理Escape键
    document.addEventListener('keydown', function(event) {
      if (event.key === 'Escape') {
        const envVarsModal = document.getElementById('envVarsModal');
        const eventsModal = document.getElementById('eventsModal');
        
        if (envVarsModal.classList.contains('show')) {
          if (editingKey) {
            cancelInlineEdit(editingKey);
          } else {
            closeEnvVarsModal();
          }
        } else if (eventsModal.classList.contains('show')) {
          closeEventsModal();
        }
      }
    });
    
    // 初始化页面
    document.addEventListener('DOMContentLoaded', fetchServices);
  </script>
</body>
</html>
  `;
  
  return new Response(html, {
    headers: { 'Content-Type': 'text/html' }
  });
}
