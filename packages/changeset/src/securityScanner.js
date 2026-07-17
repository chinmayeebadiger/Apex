"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanTemplateSecurity = void 0;
const schemas_js_1 = require("./schemas.js");
const asArray = (value) => {
    if (value === undefined) {
        return [];
    }
    return Array.isArray(value) ? value : [value];
};
const containsWildcard = (value) => asArray(value).some((entry) => entry === '*');
const statementHasWildcard = (statement, fieldName) => {
    if (!statement || typeof statement !== 'object') {
        return false;
    }
    return containsWildcard(statement[fieldName]);
};
const collectPolicyStatements = (properties) => {
    const policyDocument = properties.PolicyDocument;
    if (!policyDocument || typeof policyDocument !== 'object') {
        return [];
    }
    return asArray(policyDocument.Statement);
};
const s3PublicAccessIsMissingOrPermissive = (properties) => {
    const config = properties.PublicAccessBlockConfiguration;
    if (!config || typeof config !== 'object') {
        return true;
    }
    const typedConfig = config;
    return [
        'BlockPublicAcls',
        'BlockPublicPolicy',
        'IgnorePublicAcls',
        'RestrictPublicBuckets',
    ].some((key) => typedConfig[key] !== true);
};
const scanTemplateSecurity = (templateInput) => {
    const template = schemas_js_1.CloudFormationTemplateSchema.parse(templateInput);
    const flags = [];
    for (const [logicalId, resource] of Object.entries(template.Resources)) {
        const properties = resource.Properties ?? {};
        if (resource.Type === 'AWS::IAM::Policy') {
            for (const statement of collectPolicyStatements(properties)) {
                if (statementHasWildcard(statement, 'Action')) {
                    flags.push({
                        logicalId,
                        severity: 'high',
                        message: 'IAM policy allows all actions with Action "*". Narrow this to the specific AWS APIs required.',
                    });
                }
                if (statementHasWildcard(statement, 'Resource')) {
                    flags.push({
                        logicalId,
                        severity: 'high',
                        message: 'IAM policy applies to all resources with Resource "*". Scope it to specific ARNs where possible.',
                    });
                }
            }
        }
        if (resource.Type === 'AWS::S3::Bucket') {
            if (s3PublicAccessIsMissingOrPermissive(properties)) {
                flags.push({
                    logicalId,
                    severity: 'high',
                    message: 'S3 bucket does not fully block public access.',
                });
            }
            if (!properties.BucketEncryption) {
                flags.push({
                    logicalId,
                    severity: 'medium',
                    message: 'S3 bucket does not explicitly enable encryption at rest.',
                });
            }
        }
        if (resource.Type === 'AWS::RDS::DBInstance' &&
            properties.StorageEncrypted !== true) {
            flags.push({
                logicalId,
                severity: 'medium',
                message: 'RDS DB instance does not explicitly enable storage encryption.',
            });
        }
        if (resource.Type === 'AWS::RDS::DBCluster' &&
            properties.StorageEncrypted !== true) {
            flags.push({
                logicalId,
                severity: 'medium',
                message: 'RDS DB cluster does not explicitly enable storage encryption.',
            });
        }
        if (resource.Type === 'AWS::EC2::SecurityGroup') {
            for (const rule of asArray(properties.SecurityGroupIngress)) {
                if (!rule || typeof rule !== 'object') {
                    continue;
                }
                const cidr = rule.CidrIp;
                if (cidr === '0.0.0.0/0') {
                    flags.push({
                        logicalId,
                        severity: 'high',
                        message: 'Security group allows inbound traffic from 0.0.0.0/0 (open to the internet).',
                    });
                    break;
                }
            }
        }
    }
    return schemas_js_1.SecurityScanSchema.parse({ flags });
};
exports.scanTemplateSecurity = scanTemplateSecurity;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2VjdXJpdHlTY2FubmVyLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsic2VjdXJpdHlTY2FubmVyLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLDZDQUtzQjtBQUV0QixNQUFNLE9BQU8sR0FBRyxDQUFJLEtBQTBCLEVBQU8sRUFBRTtJQUNyRCxJQUFJLEtBQUssS0FBSyxTQUFTLEVBQUUsQ0FBQztRQUN4QixPQUFPLEVBQUUsQ0FBQztJQUNaLENBQUM7SUFFRCxPQUFPLEtBQUssQ0FBQyxPQUFPLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQztBQUNoRCxDQUFDLENBQUM7QUFFRixNQUFNLGdCQUFnQixHQUFHLENBQUMsS0FBYyxFQUFXLEVBQUUsQ0FDbkQsT0FBTyxDQUFDLEtBQXNDLENBQUMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLEtBQUssS0FBSyxHQUFHLENBQUMsQ0FBQztBQUVqRixNQUFNLG9CQUFvQixHQUFHLENBQUMsU0FBa0IsRUFBRSxTQUFnQyxFQUFXLEVBQUU7SUFDN0YsSUFBSSxDQUFDLFNBQVMsSUFBSSxPQUFPLFNBQVMsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUNoRCxPQUFPLEtBQUssQ0FBQztJQUNmLENBQUM7SUFFRCxPQUFPLGdCQUFnQixDQUFFLFNBQXFDLENBQUMsU0FBUyxDQUFDLENBQUMsQ0FBQztBQUM3RSxDQUFDLENBQUM7QUFFRixNQUFNLHVCQUF1QixHQUFHLENBQUMsVUFBbUMsRUFBYSxFQUFFO0lBQ2pGLE1BQU0sY0FBYyxHQUFHLFVBQVUsQ0FBQyxjQUFjLENBQUM7SUFDakQsSUFBSSxDQUFDLGNBQWMsSUFBSSxPQUFPLGNBQWMsS0FBSyxRQUFRLEVBQUUsQ0FBQztRQUMxRCxPQUFPLEVBQUUsQ0FBQztJQUNaLENBQUM7SUFFRCxPQUFPLE9BQU8sQ0FBRSxjQUEwQyxDQUFDLFNBQVMs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Q1QsUUFBUSxFQUFFLFFBQVE7Z0JBQ2xCLE9BQU8sRUFBRSwrREFBK0Q7YUFDekUsQ0FBQyxDQUFDO1FBQ0wsQ0FBQztRQUVELElBQUksUUFBUSxDQUFDLElBQUksS0FBSyx5QkFBeUIsRUFBRSxDQUFDO1lBQ2hELEtBQUssTUFBTSxJQUFJLElBQUksT0FBTyxDQUFDLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxFQUFFLENBQUM7Z0JBQzVELElBQUksQ0FBQyxJQUFJLElBQUksT0FBTyxJQUFJLEtBQUssUUFBUSxFQUFFLENBQUM7b0JBQ3RDLFNBQVM7Z0JBQ1gsQ0FBQztnQkFFRCxNQUFNLElBQUksR0FBSSxJQUFnQyxDQUFDLE1BQU0sQ0FBQztnQkFDdEQsSUFBSSxJQUFJLEtBQUssV0FBVyxFQUFFLENBQUM7b0JBQ3pCLEtBQUssQ0FBQyxJQUFJLENBQUM7d0JBQ1QsU0FBUzt3QkFDVCxRQUFRLEVBQUUsTUFBTTt3QkFDaEIsT0FBTyxFQUFFLDhFQUE4RTtxQkFDeEYsQ0FBQyxDQUFDO29CQUNILE1BQU07Z0JBQ1IsQ0FBQztZQUNILENBQUM7UUFDSCxDQUFDO0lBQ0gsQ0FBQztJQUVELE9BQU8sK0JBQWtCLENBQUMsS0FBSyxDQUFDLEVBQUUsS0FBSyxFQUFFLENBQUMsQ0FBQztBQUM3QyxDQUFDLENBQUM7QUF2RlcsUUFBQSxvQkFBb0Isd0JBdUYvQiIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7XG4gIENsb3VkRm9ybWF0aW9uVGVtcGxhdGVTY2hlbWEsXG4gIFNlY3VyaXR5RmxhZyxcbiAgU2VjdXJpdHlTY2FuLFxuICBTZWN1cml0eVNjYW5TY2hlbWEsXG59IGZyb20gJy4vc2NoZW1hcy5qcyc7XG5cbmNvbnN0IGFzQXJyYXkgPSA8VD4odmFsdWU6IFQgfCBUW10gfCB1bmRlZmluZWQpOiBUW10gPT4ge1xuICBpZiAodmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIHJldHVybiBBcnJheS5pc0FycmF5KHZhbHVlKSA/IHZhbHVlIDogW3ZhbHVlXTtcbn07XG5cbmNvbnN0IGNvbnRhaW5zV2lsZGNhcmQgPSAodmFsdWU6IHVua25vd24pOiBib29sZWFuID0+XG4gIGFzQXJyYXkodmFsdWUgYXMgc3RyaW5nIHwgc3RyaW5nW10gfCB1bmRlZmluZWQpLnNvbWUoKGVudHJ5KSA9PiBlbnRyeSA9PT0gJyonKTtcblxuY29uc3Qgc3RhdGVtZW50SGFzV2lsZGNhcmQgPSAoc3RhdGVtZW50OiB1bmtub3duLCBmaWVsZE5hbWU6ICdBY3Rpb24nIHwgJ1Jlc291cmNlJyk6IGJvb2xlYW4gPT4ge1xuICBpZiAoIXN0YXRlbWVudCB8fCB0eXBlb2Ygc3RhdGVtZW50ICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiBjb250YWluc1dpbGRjYXJkKChzdGF0ZW1lbnQgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4pW2ZpZWxkTmFtZV0pO1xufTtcblxuY29uc3QgY29sbGVjdFBvbGljeVN0YXRlbWVudHMgPSAocHJvcGVydGllczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiB1bmtub3duW10gPT4ge1xuICBjb25zdCBwb2xpY3lEb2N1bWVudCA9IHByb3BlcnRpZXMuUG9saWN5RG9jdW1lbnQ7XG4gIGlmICghcG9saWN5RG9jdW1lbnQgfHwgdHlwZW9mIHBvbGljeURvY3VtZW50ICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIHJldHVybiBhc0FycmF5KChwb2xpY3lEb2N1bWVudCBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuU3RhdGVtZW50KTtcbn07XG5cbmNvbnN0IHMzUHVibGljQWNjZXNzSXNNaXNzaW5nT3JQZXJtaXNzaXZlID0gKHByb3BlcnRpZXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogYm9vbGVhbiA9PiB7XG4gIGNvbnN0IGNvbmZpZyA9IHByb3BlcnRpZXMuUHVibGljQWNjZXNzQmxvY2tDb25maWd1cmF0aW9uO1xuICBpZiAoIWNvbmZpZyB8fCB0eXBlb2YgY29uZmlnICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgY29uc3QgdHlwZWRDb25maWcgPSBjb25maWcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIHJldHVybiBbXG4gICAgJ0Jsb2NrUHVibGljQWNscycsXG4gICAgJ0Jsb2NrUHVibGljUG9saWN5JyxcbiAgICAnSWdub3JlUHVibGljQWNscycsXG4gICAgJ1Jlc3RyaWN0UHVibGljQnVja2V0cycsXG4gIF0uc29tZSgoa2V5KSA9PiB0eXBlZENvbmZpZ1trZXldICE9PSB0cnVlKTtcbn07XG5cbmV4cG9ydCBjb25zdCBzY2FuVGVtcGxhdGVTZWN1cml0eSA9ICh0ZW1wbGF0ZUlucHV0OiB1bmtub3duKTogU2VjdXJpdHlTY2FuID0+IHtcbiAgY29uc3QgdGVtcGxhdGUgPSBDbG91ZEZvcm1hdGlvblRlbXBsYXRlU2NoZW1hLnBhcnNlKHRlbXBsYXRlSW5wdXQpO1xuICBjb25zdCBmbGFnczogU2VjdXJpdHlGbGFnW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IFtsb2dpY2FsSWQsIHJlc291cmNlXSBvZiBPYmplY3QuZW50cmllcyh0ZW1wbGF0ZS5SZXNvdXJjZXMpKSB7XG4gICAgY29uc3QgcHJvcGVydGllcyA9IHJlc291cmNlLlByb3BlcnRpZXMgPz8ge307XG5cbiAgICBpZiAocmVzb3VyY2UuVHlwZSA9PT0gJ0FXUzo6SUFNOjpQb2xpY3knKSB7XG4gICAgICBmb3IgKGNvbnN0IHN0YXRlbWVudCBvZiBjb2xsZWN0UG9saWN5U3RhdGVtZW50cyhwcm9wZXJ0aWVzKSkge1xuICAgICAgICBpZiAoc3RhdGVtZW50SGFzV2lsZGNhcmQoc3RhdGVtZW50LCAnQWN0aW9uJykpIHtcbiAgICAgICAgICBmbGFncy5wdXNoKHtcbiAgICAgICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaGlnaCcsXG4gICAgICAgICAgICBtZXNzYWdlOiAnSUFNIHBvbGljeSBhbGxvd3MgYWxsIGFjdGlvbnMgd2l0aCBBY3Rpb24gXCIqXCIuIE5hcnJvdyB0aGlzIHRvIHRoZSBzcGVjaWZpYyBBV1MgQVBJcyByZXF1aXJlZC4nLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKHN0YXRlbWVudEhhc1dpbGRjYXJkKHN0YXRlbWVudCwgJ1Jlc291cmNlJykpIHtcbiAgICAgICAgICBmbGFncy5wdXNoKHtcbiAgICAgICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaGlnaCcsXG4gICAgICAgICAgICBtZXNzYWdlOiAnSUFNIHBvbGljeSBhcHBsaWVzIHRvIGFsbCByZXNvdXJjZXMgd2l0aCBSZXNvdXJjZSBcIipcIi4gU2NvcGUgaXQgdG8gc3BlY2lmaWMgQVJOcyB3aGVyZSBwb3NzaWJsZS4nLFxuICAgICAgICAgIH0pO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHJlc291cmNlLlR5cGUgPT09ICdBV1M6OlMzOjpCdWNrZXQnKSB7XG4gICAgICBpZiAoczNQdWJsaWNBY2Nlc3NJc01pc3NpbmdPclBlcm1pc3NpdmUocHJvcGVydGllcykpIHtcbiAgICAgICAgZmxhZ3MucHVzaCh7XG4gICAgICAgICAgbG9naWNhbElkLFxuICAgICAgICAgIHNldmVyaXR5OiAnaGlnaCcsXG4gICAgICAgICAgbWVzc2FnZTogJ1MzIGJ1Y2tldCBkb2VzIG5vdCBmdWxseSBibG9jayBwdWJsaWMgYWNjZXNzLicsXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICBpZiAoIXByb3BlcnRpZXMuQnVja2V0RW5jcnlwdGlvbikge1xuICAgICAgICBmbGFncy5wdXNoKHtcbiAgICAgICAgICBsb2dpY2FsSWQsXG4gICAgICAgICAgc2V2ZXJpdHk6ICdtZWRpdW0nLFxuICAgICAgICAgIG1lc3NhZ2U6ICdTMyBidWNrZXQgZG9lcyBub3QgZXhwbGljaXRseSBlbmFibGUgZW5jcnlwdGlvbiBhdCByZXN0LicsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChcbiAgICAgIHJlc291cmNlLlR5cGUgPT09ICdBV1M6OlJEUzo6REJJbnN0YW5jZScgJiZcbiAgICAgIHByb3BlcnRpZXMuU3RvcmFnZUVuY3J5cHRlZCAhPT0gdHJ1ZVxuICAgICkge1xuICAgICAgZmxhZ3MucHVzaCh7XG4gICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgc2V2ZXJpdHk6ICdtZWRpdW0nLFxuICAgICAgICBtZXNzYWdlOiAnUkRTIERCIGluc3RhbmNlIGRvZXMgbm90IGV4cGxpY2l0bHkgZW5hYmxlIHN0b3JhZ2UgZW5jcnlwdGlvbi4nLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKFxuICAgICAgcmVzb3VyY2UuVHlwZSA9PT0gJ0FXUzo6UkRTOjpEQkNsdXN0ZXInICYmXG4gICAgICBwcm9wZXJ0aWVzLlN0b3JhZ2VFbmNyeXB0ZWQgIT09IHRydWVcbiAgICApIHtcbiAgICAgIGZsYWdzLnB1c2goe1xuICAgICAgICBsb2dpY2FsSWQsXG4gICAgICAgIHNldmVyaXR5OiAnbWVkaXVtJyxcbiAgICAgICAgbWVzc2FnZTogJ1JEUyBEQiBjbHVzdGVyIGRvZXMgbm90IGV4cGxpY2l0bHkgZW5hYmxlIHN0b3JhZ2UgZW5jcnlwdGlvbi4nLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHJlc291cmNlLlR5cGUgPT09ICdBV1M6OkVDMjo6U2VjdXJpdHlHcm91cCcpIHtcbiAgICAgIGZvciAoY29uc3QgcnVsZSBvZiBhc0FycmF5KHByb3BlcnRpZXMuU2VjdXJpdHlHcm91cEluZ3Jlc3MpKSB7XG4gICAgICAgIGlmICghcnVsZSB8fCB0eXBlb2YgcnVsZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGNvbnN0IGNpZHIgPSAocnVsZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikuQ2lkcklwO1xuICAgICAgICBpZiAoY2lkciA9PT0gJzAuMC4wLjAvMCcpIHtcbiAgICAgICAgICBmbGFncy5wdXNoKHtcbiAgICAgICAgICAgIGxvZ2ljYWxJZCxcbiAgICAgICAgICAgIHNldmVyaXR5OiAnaGlnaCcsXG4gICAgICAgICAgICBtZXNzYWdlOiAnU2VjdXJpdHkgZ3JvdXAgYWxsb3dzIGluYm91bmQgdHJhZmZpYyBmcm9tIDAuMC4wLjAvMCAob3BlbiB0byB0aGUgaW50ZXJuZXQpLicsXG4gICAgICAgICAgfSk7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gU2VjdXJpdHlTY2FuU2NoZW1hLnBhcnNlKHsgZmxhZ3MgfSk7XG59O1xuIl19