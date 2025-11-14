import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import addErrors from 'ajv-errors';
export class SchemaValidator {
    logger;
    ajv;
    schemaCache = new Map();
    cacheTTL = 3600000;
    MAX_CACHE_SIZE = 1000;
    constructor(logger){
        this.logger = logger;
        this.ajv = new Ajv({
            allErrors: true,
            strict: true,
            validateFormats: true,
            allowUnionTypes: true,
            schemaId: 'auto'
        });
        addFormats(this.ajv);
        addErrors(this.ajv);
        this.logger.info('Schema validator initialized', {
            draft: '2020-12',
            formats: 'enabled'
        });
    }
    validateInput(schema, input) {
        try {
            const validate = this.getValidator(schema);
            const valid = validate(input);
            if (!valid && validate.errors) {
                return {
                    valid: false,
                    errors: this.formatErrors(validate.errors)
                };
            }
            return {
                valid: true
            };
        } catch (error) {
            this.logger.error('Schema validation error', {
                error: error instanceof Error ? error.message : String(error)
            });
            return {
                valid: false,
                errors: [
                    {
                        path: '',
                        message: 'Schema validation failed'
                    }
                ]
            };
        }
    }
    validateOutput(schema, output) {
        return this.validateInput(schema, output);
    }
    validateToolSchema(toolSchema) {
        const requiredFields = [
            '$schema',
            'type',
            'properties'
        ];
        const schemaObj = toolSchema;
        const missing = requiredFields.filter((field)=>!(field in schemaObj));
        if (missing.length > 0) {
            return {
                valid: false,
                errors: missing.map((field)=>({
                        path: '/',
                        message: `Missing required field: ${field}`
                    }))
            };
        }
        try {
            this.ajv.compile(toolSchema);
            return {
                valid: true
            };
        } catch (error) {
            return {
                valid: false,
                errors: [
                    {
                        path: '/',
                        message: error instanceof Error ? error.message : 'Invalid schema'
                    }
                ]
            };
        }
    }
    getValidator(schema) {
        const schemaKey = JSON.stringify(schema);
        const cached = this.schemaCache.get(schemaKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
            return cached.validate;
        }
        try {
            const validate = this.ajv.compile(schema);
            if (this.schemaCache.size >= this.MAX_CACHE_SIZE) {
                const oldest = Array.from(this.schemaCache.entries()).sort((a, b)=>a[1].timestamp - b[1].timestamp)[0];
                if (oldest) {
                    this.schemaCache.delete(oldest[0]);
                    this.logger.debug('Evicted oldest schema from cache', {
                        cacheSize: this.schemaCache.size,
                        maxSize: this.MAX_CACHE_SIZE
                    });
                }
            }
            this.schemaCache.set(schemaKey, {
                schema,
                validate,
                timestamp: Date.now()
            });
            return validate;
        } catch (error) {
            this.logger.error('Failed to compile schema', {
                error: error instanceof Error ? error.message : String(error)
            });
            throw error;
        }
    }
    formatErrors(errors) {
        return errors.map((err)=>({
                path: err.instancePath || '/',
                message: this.getErrorMessage(err),
                params: err.params
            }));
    }
    getErrorMessage(error) {
        const { keyword, message, params } = error;
        switch(keyword){
            case 'required':
                return `Missing required property: ${params.missingProperty}`;
            case 'type':
                return `Expected ${params.type} but got ${typeof params.data}`;
            case 'format':
                return `Invalid format for ${params.format}`;
            case 'minimum':
                return `Value must be >= ${params.limit}`;
            case 'maximum':
                return `Value must be <= ${params.limit}`;
            case 'minLength':
                return `String must be at least ${params.limit} characters`;
            case 'maxLength':
                return `String must be at most ${params.limit} characters`;
            case 'pattern':
                return `String must match pattern: ${params.pattern}`;
            case 'enum':
                return `Value must be one of: ${params.allowedValues?.join(', ')}`;
            default:
                return message || `Validation failed: ${keyword}`;
        }
    }
    clearCache() {
        this.schemaCache.clear();
        this.logger.info('Schema cache cleared');
    }
    getCacheStats() {
        return {
            size: this.schemaCache.size,
            entries: Array.from(this.schemaCache.values()).map((entry)=>({
                    age: Date.now() - entry.timestamp,
                    expired: Date.now() - entry.timestamp > this.cacheTTL
                }))
        };
    }
    cleanupCache() {
        const now = Date.now();
        let cleaned = 0;
        for (const [key, entry] of this.schemaCache.entries()){
            if (now - entry.timestamp > this.cacheTTL) {
                this.schemaCache.delete(key);
                cleaned++;
            }
        }
        if (cleaned > 0) {
            this.logger.info('Cleaned up expired schema cache entries', {
                count: cleaned
            });
        }
        return cleaned;
    }
}
export function upgradeToolSchema(legacySchema) {
    if (legacySchema.$schema && legacySchema.$schema.includes('2020-12')) {
        return legacySchema;
    }
    return {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: legacySchema.type || 'object',
        properties: legacySchema.properties || {},
        required: legacySchema.required || [],
        additionalProperties: legacySchema.additionalProperties !== undefined ? legacySchema.additionalProperties : false,
        description: legacySchema.description
    };
}

//# sourceMappingURL=schema-validator-2025.js.map