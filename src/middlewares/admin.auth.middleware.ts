import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { Admin } from '../db/models';
import { httpStatusConstant, httpErrorMessageConstant, messageConstant } from '../constant';
import { authUtils, loggerUtils } from '../utils';

const authMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const radisClient = await authUtils.createRedisClient();
        const { token } = await authUtils.validateAuthorizationHeader(req.headers);
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const key = `blocked:access:tokens`; // Customize key prefix (access or refresh)
        const isBlocked = await radisClient.sIsMember(key, hashedToken);
        if (isBlocked) {
            return res.status(httpStatusConstant.UNAUTHORIZED).json({
                status: false,
                message: httpErrorMessageConstant.TOKEN_BLACKLISTED,
            });
        }

        const verifiedToken = await authUtils.verifyAccessToken(token);

        if (!(verifiedToken.tokenType == 'access')) {
            return res.status(httpStatusConstant.INVALID_TOKEN).json({
                status: false,
                message: messageConstant.INVALID_TOKEN_TYPE,
            });
        }
        const admin = await Admin.findOne({ email: verifiedToken.email, isActive: true });

        if (!admin) {
            return res.status(httpStatusConstant.NOT_FOUND).json({
                status: false,
                message: messageConstant.ADMIN_NOT_FOUND,
            });
        }
        next();
    } catch (error: any) {
        loggerUtils.logger.error(error);
        return res.status(httpStatusConstant.INTERNAL_SERVER_ERROR).json({
            message: httpErrorMessageConstant.INTERNAL_SERVER_ERROR,
            error: error.message,
        });
    }
};

export default {
    authMiddleware,
};
