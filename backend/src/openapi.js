
const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'MediRecuerda API',
    version: '1.0.0',
    description: `
API REST del backend de MediRecuerda.

Incluye autenticación de usuarios, asistencia mediante IA,
extracción de medicamentos desde órdenes médicas y búsqueda de imágenes.

Las rutas protegidas utilizan la clave de aplicación x-app-key.
Las operaciones que requieren una sesión utilizan JWT Bearer.
    `,
  },
  servers: [
    {
      url: 'https://medirecuerda-api.onrender.com',
      description: 'Servidor de producción en Render',
    },
    {
      url: 'http://localhost:3000',
      description: 'Servidor local',
    },
  ],
  tags: [
    { name: 'Estado', description: 'Estado del servicio' },
    { name: 'Autenticación', description: 'Registro, acceso y gestión de cuentas' },
    { name: 'Inteligencia artificial', description: 'Asistente y extracción de órdenes médicas' },
    { name: 'Imágenes', description: 'Búsqueda de imágenes de medicamentos' },
  ],
  components: {
    securitySchemes: {
      appKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-app-key',
        description: 'Clave de aplicación configurada mediante APP_API_KEY.',
      },
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT obtenido al iniciar sesión o registrarse.',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          error: { type: 'string', example: 'Solicitud no autorizada.' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          provider: { type: 'string', example: 'password' },
          name: { type: 'string' },
          photoUrl: { type: 'string', nullable: true },
        },
      },
      Session: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'JWT de sesión.' },
          user: { $ref: '#/components/schemas/User' },
        },
        required: ['token', 'user'],
      },
    },
  },
  paths: {
    '/': {
      get: {
        tags: ['Estado'],
        summary: 'Verificar el servicio',
        security: [],
        responses: {
          200: {
            description: 'Servicio disponible.',
            content: {
              'application/json': {
                example: { name: 'MediRecuerda API', status: 'ok' },
              },
            },
          },
        },
      },
    },
    '/health': {
      get: {
        tags: ['Estado'],
        summary: 'Comprobar conexión con la base de datos',
        security: [],
        responses: {
          200: {
            description: 'Base de datos disponible.',
            content: {
              'application/json': {
                example: { ok: true },
              },
            },
          },
          503: {
            description: 'Base de datos no disponible.',
            content: {
              'application/json': {
                example: { ok: false, error: 'Base de datos no disponible.' },
              },
            },
          },
        },
      },
    },
    '/auth/register': {
      post: {
        tags: ['Autenticación'],
        summary: 'Registrar una cuenta',
        security: [{ appKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password'],
                properties: {
                  name: { type: 'string', example: 'María Pérez' },
                  email: { type: 'string', format: 'email', example: 'maria@correo.com' },
                  password: { type: 'string', minLength: 8, example: 'ClaveSegura123' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Cuenta creada y sesión iniciada.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
          400: { description: 'Datos inválidos.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          401: { description: 'Clave de aplicación incorrecta.' },
          409: { description: 'Ya existe una cuenta con ese correo.' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión con correo y contraseña',
        security: [{ appKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'maria@correo.com' },
                  password: { type: 'string', example: 'ClaveSegura123' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Sesión iniciada.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
          400: { description: 'La cuenta requiere acceso con Google.' },
          401: { description: 'Credenciales incorrectas.' },
        },
      },
    },
    '/auth/google': {
      post: {
        tags: ['Autenticación'],
        summary: 'Iniciar sesión con Google',
        description: 'El servidor verifica el idToken con Google. Requiere GOOGLE_WEB_CLIENT_ID configurado.',
        security: [{ appKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['idToken'],
                properties: {
                  idToken: { type: 'string', description: 'Token de identidad emitido por Google.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Sesión iniciada.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Session' } } } },
          400: { description: 'Falta el token de Google.' },
          401: { description: 'Token de Google inválido o correo no verificado.' },
          503: { description: 'Acceso con Google no configurado.' },
        },
      },
    },
    '/auth/forgot-password': {
      post: {
        tags: ['Autenticación'],
        summary: 'Solicitar recuperación de contraseña',
        description: 'Envía un código de seis dígitos al correo si existe una cuenta asociada.',
        security: [{ appKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'maria@correo.com' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Solicitud procesada.', content: { 'application/json': { example: { ok: true, message: 'Si el correo está registrado, te enviamos un código.' } } } },
          400: { description: 'Correo inválido.' },
        },
      },
    },
    '/auth/reset-password': {
      post: {
        tags: ['Autenticación'],
        summary: 'Restablecer contraseña',
        description: 'Utiliza el código enviado al correo. El código vence después de 15 minutos.',
        security: [{ appKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'code', 'newPassword'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  code: { type: 'string', minLength: 6, maxLength: 6, example: '123456' },
                  newPassword: { type: 'string', minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Contraseña restablecida.', content: { 'application/json': { example: { ok: true } } } },
          400: { description: 'Código inválido, vencido o contraseña insuficiente.' },
        },
      },
    },
    '/auth/change-password': {
      post: {
        tags: ['Autenticación'],
        summary: 'Cambiar contraseña con sesión iniciada',
        security: [{ appKey: [], bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['current', 'newPassword'],
                properties: {
                  current: { type: 'string', description: 'Contraseña actual.' },
                  newPassword: { type: 'string', minLength: 8, description: 'Nueva contraseña.' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Contraseña actualizada.', content: { 'application/json': { example: { ok: true } } } },
          400: { description: 'Nueva contraseña insuficiente o cuenta de Google.' },
          401: { description: 'Sesión o contraseña actual incorrecta.' },
        },
      },
    },
    '/auth/me': {
      get: {
        tags: ['Autenticación'],
        summary: 'Consultar usuario autenticado',
        security: [{ appKey: [], bearerAuth: [] }],
        responses: {
          200: {
            description: 'Datos públicos del usuario.',
            content: {
              'application/json': {
                example: {
                  user: {
                    id: 'uuid',
                    email: 'maria@correo.com',
                    provider: 'password',
                    name: 'María Pérez',
                    photoUrl: null,
                    createdAt: '2026-11-20T15:04:05.000Z',
                  },
                },
              },
            },
          },
          401: { description: 'Sesión no válida.' },
        },
      },
    },
    '/auth/account': {
      delete: {
        tags: ['Autenticación'],
        summary: 'Eliminar la cuenta',
        description: 'Envía al correo registrado el historial (resumen y CSV adjunto) y después borra el usuario con todos sus datos. Si el correo no se puede enviar, no se borra nada.',
        security: [{ appKey: [], bearerAuth: [] }],
        responses: {
          200: { description: 'Historial enviado y cuenta eliminada.', content: { 'application/json': { example: { ok: true } } } },
          401: { description: 'Sesión no válida.' },
          502: { description: 'No se pudo enviar el correo; la cuenta NO se eliminó.' },
        },
      },
    },
    '/ai/chat': {
      post: {
        tags: ['Inteligencia artificial'],
        summary: 'Consultar al asistente de MediRecuerda',
        description: 'La sesión de usuario es opcional. Se aceptan hasta 12 mensajes; cada mensaje admite hasta 1500 caracteres y el contexto hasta 3000.',
        security: [{ appKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['messages'],
                properties: {
                  messages: {
                    type: 'array',
                    items: {
                      type: 'object',
                      required: ['role', 'content'],
                      properties: {
                        role: { type: 'string', enum: ['user', 'assistant'] },
                        content: { type: 'string', example: '¿Para qué sirve el medicamento?' },
                      },
                    },
                  },
                  context: { type: 'string', description: 'Contexto opcional del usuario.' },
                },
              },
              example: {
                messages: [{ role: 'user', content: '¿Para qué sirve el acetaminofén?' }],
                context: '',
              },
            },
          },
        },
        responses: {
          200: { description: 'Respuesta del asistente.', content: { 'application/json': { example: { reply: 'El acetaminofén se utiliza para aliviar el dolor y reducir la fiebre.' } } } },
          400: { description: 'No se proporcionó una pregunta válida.' },
          429: { description: 'Límite de consultas alcanzado.' },
          502: { description: 'Error en el servicio de IA.' },
          503: { description: 'IA no configurada.' },
          504: { description: 'Tiempo de espera agotado.' },
        },
      },
    },
    '/ai/extract': {
      post: {
        tags: ['Inteligencia artificial'],
        summary: 'Extraer medicamentos de una orden médica',
        description: 'Admite texto, imagen en Base64 o ambos. Formatos de imagen: JPEG, PNG y WEBP. La imagen admite hasta 6 millones de caracteres Base64.',
        security: [{ appKey: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  text: { type: 'string', description: 'Texto de la orden médica.' },
                  imageBase64: { type: 'string', description: 'Contenido de la imagen codificado en Base64.' },
                  mime: { type: 'string', enum: ['image/jpeg', 'image/png', 'image/webp'], example: 'image/jpeg' },
                },
              },
              example: {
                text: 'Orden médica: acetaminofén 500 mg',
                mime: 'image/jpeg',
              },
            },
          },
        },
        responses: {
          200: { description: 'Contenido extraído por la IA.', content: { 'application/json': { example: { content: 'Medicamento: acetaminofén 500 mg' } } } },
          400: { description: 'No se envió texto ni imagen, o la imagen no es válida.' },
          413: { description: 'Imagen demasiado grande.' },
          502: { description: 'Error en el servicio de IA.' },
          503: { description: 'IA no configurada.' },
          504: { description: 'Tiempo de espera agotado.' },
        },
      },
    },
    '/images/search': {
      get: {
        tags: ['Imágenes'],
        summary: 'Buscar imagen de un medicamento',
        description: 'Busca una imagen en fuentes externas. Si no encuentra una imagen, devuelve un objeto vacío.',
        security: [{ appKey: [] }],
        parameters: [
          {
            name: 'name',
            in: 'query',
            required: true,
            schema: { type: 'string', maxLength: 80 },
            description: 'Nombre del medicamento.',
            example: 'Acetaminofén',
          },
          {
            name: 'activeIngredient',
            in: 'query',
            schema: { type: 'string', maxLength: 80 },
            description: 'Principio activo.',
          },
          {
            name: 'strength',
            in: 'query',
            schema: { type: 'string', maxLength: 80 },
            description: 'Concentración.',
          },
          {
            name: 'form',
            in: 'query',
            schema: { type: 'string', maxLength: 80 },
            description: 'Forma farmacéutica.',
          },
        ],
        responses: {
          200: {
            description: 'Imagen encontrada o un objeto vacío.',
            content: {
              'application/json': {
                examples: {
                  encontrada: {
                    value: {
                      url: 'https://ejemplo.com/imagen.jpg',
                      source: 'farmatodo.com.co',
                      colombian: true,
                    },
                  },
                  noEncontrada: { value: {} },
                },
              },
            },
          },
          400: { description: 'Falta el nombre del medicamento.' },
        },
      },
    },
  },
};

export default openApiSpec;
