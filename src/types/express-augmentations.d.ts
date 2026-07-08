// Augments Express.Request with properties added by our auth middleware.
declare global {
    namespace Express {
        interface Request {
            /** Set by verifyToken middleware after a valid JWT is presented. */
            userId?: number;
        }
    }
}

export {};
