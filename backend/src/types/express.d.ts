export type AppRole = 'super_admin' | 'administrator' | 'lecturer' | 'student';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        email: string;
        role: AppRole;
        sessionId: string;
        fullName: string;
      };
      requestId: string;
      rawBody?: Buffer;
    }
  }
}

export {};
