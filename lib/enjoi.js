'use strict';

const Joi = require('joi-browser');
const isArray = require('lodash/isArray');
const isNumber = require('lodash/isNumber');
const isObject = require('lodash/isObject');
const isUndefined = require('lodash/isUndefined');
const {assert} = require('hoek');

const schemaSchema = Joi.alternatives(Joi.object().unknown(true), Joi.string()).required();

const optionsSchema = Joi.object({
    subSchemas: Joi.object().unknown(true).allow(null),
    types: Joi.object().unknown(true).allow(null),
    refineType: Joi.func().allow(null),
    strictMode: Joi.boolean().default(false)
});

module.exports = function (schema, options = {}) {

    const validateSchema = Joi.validate(schema, schemaSchema);

    assert(!validateSchema.error, validateSchema.error);

    const validateOptions = Joi.validate(options, optionsSchema);

    assert(!validateOptions.error, validateOptions.error);

    const { subSchemas, types, refineType, strictMode } = validateOptions.value;

    function resolve(current) {
        if (current.type) {
            return resolvetype(current);
        }

        if (current.anyOf) {
            return resolveAnyOf(current);
        }

        if (current.allOf) {
            return resolveAllOf(current);
        }

        if (current.oneOf) {
            return resolveOneOf(current);
        }

        if (current.not) {
            return resolveNot(current);
        }

        if (current.$ref) {
            return resolve(resolveref(current.$ref));
        }

        //if no type is specified, just enum
        if (current.enum) {
            return Joi.any().valid(current.enum);
        }

        // If current is itself a string, interpret it as a type
        if (typeof current === 'string') {
            return resolvetype({ type: current });
        }

        //Fall through to whatever.
        //eslint-disable-next-line no-console
        console.warn('WARNING: schema missing a \'type\' or \'$ref\' or \'enum\': %s', JSON.stringify(current));
        return Joi.any();
    }

    // Resolve a value as if it was an array, a single value is translated to an array of one item
    function resolveAsArray(value) {
        if (isArray(value)) {
            // found an array, thus its _per type_
            return value.map(function (v) { return resolve(v); });
        }
        // it's a single entity, so just resolve it normally
        return [resolve(value)];
    }

    function resolveref(value) {
        let refschema;

        const id = value.substr(0, value.indexOf('#') + 1);
        const path = value.substr(value.indexOf('#') + 1);

        if (id && subSchemas) {
            refschema = subSchemas[id] || subSchemas[id.substr(0, id.length - 1)];
        }
        if (!refschema) {
            refschema = schema;
        }

        assert(refschema, 'Can not find schema reference: ' + value + '.');

        let fragment = refschema;
        const paths = path.split('/');

        for (let i = 1; i < paths.length && fragment; i++) {
            fragment = typeof fragment === 'object' && fragment[paths[i]];
        }

        return fragment;
    }

    function resolvetype(current) {
        let joischema;

        const typeDefinitionMap = {
            description: 'description',
            title: 'label',
            default: 'default'
        };

        function joitype(type, format) {
            let joischema;

            if (refineType) {
                type = refineType(type, format);
            }

            switch (type) {
                case 'array':
                    joischema = array(current);
                    break;
                case 'boolean':
                    joischema = Joi.boolean();
                    break;
                case 'integer':
                case 'number':
                    joischema = number(current);
                    break;
                case 'object':
                    joischema = object(current);
                    break;
                case 'string':
                    joischema = string(current);
                    break;
                case 'null':
                    joischema = Joi.any().valid(null);
                    break;
                default:
                    if (types) {
                        joischema = types[type];
                    }
            }

            assert(joischema, 'Could not resolve type: ' + current.type + '.');

            return joischema.strict(strictMode);
        }

        if (isArray(current.type)) {
            const schemas = [];

            for (let i = 0; i < current.type.length; i++) {
                schemas.push(joitype(current.type[i], current.format));
            }

            joischema = Joi.alternatives(schemas);
        }
        else {
            joischema = joitype(current.type, current.format);
        }

        Object.keys(typeDefinitionMap).forEach(function (key) {
            if (current[key]) {
                joischema = joischema[typeDefinitionMap[key]](current[key]);
            }
        });

        return joischema;
    }

    function resolveAnyOf(current) {
        assert(isArray(current.anyOf), 'Expected anyOf to be an array.');

        return Joi.alternatives().try(current.anyOf.map(function (schema) {
            return resolve(schema);
        }));
    }

    function resolveAllOf(current) {
        assert(isArray(current.allOf), 'Expected allOf to be an array.');

        const type = getSchemaType(current.allOf[0]);
        current.allOf.map(function (schema) {
            const _type = getSchemaType(schema);
            assert((_type === 'array' || _type === 'object') && type === _type,
                'Expected allOf item to be an array or object.');
        })

        if (type === 'object') {
            return resolve(mergeObject(current.allOf));
        }
        else {
            return resolve(mergeArray(current.allOf));
        }
    }

    function resolveOneOf(current) {
        assert(isArray(current.oneOf), 'Expected allOf to be an array.');

        return Joi.alternatives().try(current.oneOf.map(function (schema) {
            return resolve(schema);
        })).required();
    }

    function resolveNot(current) {
        assert(isArray(current.not), 'Expected Not to be an array.');

        return Joi.alternatives().when(Joi.alternatives().try(current.not.map(function (schema) {
            return resolve(schema);
        })), {then: Joi.any().forbidden(), otherwise: Joi.any()});
    }

    function resolveproperties(current) {
        const schemas = {};

        if (!isObject(current.properties)) {
            return;
        }

        Object.keys(current.properties).forEach(function (key) {
            const property = current.properties[key];

            let joischema = resolve(property);

            if (current.required && !!~current.required.indexOf(key)) {
                joischema = joischema.required();
            }

            schemas[key] = joischema;
        });

        return schemas;
    }

    function object(current) {
        let joischema = Joi.object(resolveproperties(current));

        if (current.additionalProperties === true) {
            joischema = joischema.unknown(true);
        }

        if (isObject(current.additionalProperties)) {
            joischema = joischema.pattern(/^/, resolve(current.additionalProperties));
        }

        isNumber(current.minProperties) && (joischema = joischema.min(current.minProperties));
        isNumber(current.maxProperties) && (joischema = joischema.max(current.maxProperties));

        return joischema;
    }

    function array(current) {
        let joischema = Joi.array();
        let items;

        if (current.items) {
            items = resolveAsArray(current.items);

            joischema = joischema.items(items);
        }
        else if (current.ordered) {
            items = resolveAsArray(current.ordered);
            joischema = joischema.ordered(items);
        }

        if (items && current.additionalItems === false) {
            joischema = joischema.max(items.length);
        }

        isNumber(current.minItems) && (joischema = joischema.min(current.minItems));
        isNumber(current.maxItems) && (joischema = joischema.max(current.maxItems));

        if (current.uniqueItems) {
            joischema = joischema.unique();
        }

        return joischema;
    }

    function number(current) {
        let joischema = Joi.number();

        if (current.type === 'integer') {
            joischema = joischema.integer();
        }

        isNumber(current.minimum) && (joischema = joischema.min(current.minimum));
        isNumber(current.maximum) && (joischema = joischema.max(current.maximum));
        isNumber(current.exclusiveMinimum) && (joischema = joischema.greater(current.exclusiveMinimum));
        isNumber(current.exclusiveMaximum) && (joischema = joischema.less(current.exclusiveMaximum));
        isNumber(current.multipleOf) && current.multipleOf !== 0 && (joischema = joischema.multiple(current.multipleOf));

        return joischema;
    }

    function string(current) {
        let joischema = Joi.string();

        if (current.enum) {
            return Joi.any().valid(current.enum);
        }

        switch (current.format) {
            case 'date':
            case 'date-time':
                return date(current);
            case 'binary':
                return binary(current);
            case 'email':
                joischema = joischema.email();
                break;
            case 'hostname':
                joischema = joischema.hostname();
                break;
            case 'ipv4':
                joischema = joischema.ip(['ipv4']);
                break;
            case 'ipv6':
                joischema = joischema.ip(['ipv6']);
                break;
            case 'uri':
                joischema = joischema.uri();
                break;
            case 'byte':
                joischema = joischema.base64();
                break;
        }
        return regularString(current, joischema);
    }

    function regularString(current, joischema) {
        current.pattern && (joischema = joischema.regex(new RegExp(current.pattern)));

        if (isUndefined(current.minLength)) {
            current.minLength = 0;
        }

        if (isNumber(current.minLength)) {
            if (current.minLength === 0) {
                joischema = joischema.allow('');
            }
            joischema = joischema.min(current.minLength);
        }

        isNumber(current.maxLength) && (joischema = joischema.max(current.maxLength));
        return joischema;
    }

    function date(current) {
        let joischema = Joi.date();
        current.minimum && (joischema = joischema.min(current.minimum));
        current.maximum && (joischema = joischema.max(current.maximum));
        return joischema;
    }

    function binary(current) {
        let joischema = Joi.binary();
        current.minLength && (joischema = joischema.min(current.minLength));
        current.maxLength && (joischema = joischema.max(current.maxLength));
        return joischema;
    }

    function getSchemaType(current) {
        if (current.type) {
            return current.type;
        }

        if (current.$ref) {
            return resolveref(current.$ref).type;
        }
    }

    function mergeArray(current) {
        const result = {type: 'array'};
        let items = [];
        let ordered = [];
        for (let item of current) {
            if (item.$ref) {
                item = resolveref(item.$ref);
            }
            if (item.items instanceof Array) {
                items = items.concat(item.items);
                ordered = ordered.concat(item.ordered || []);
            } else {
                items = items.concat([item.items]);
            }
        }
        result.items = items;
        result.ordered = ordered.length ? ordered : undefined;
        return result;
    }

    function mergeObject(current) {
        const result = {type: 'object', properties: {}};
        const properties = result.properties;
        let required = [];
        for (let item of current) {
            if (item.$ref) {
                item = resolveref(item.$ref);
            }
            Object.assign(properties, item.properties);
            required = required.concat(item.required || []);
        }
        result.required = required.length ? required : undefined;
        return result;
    }

    return resolve(schema);
};
