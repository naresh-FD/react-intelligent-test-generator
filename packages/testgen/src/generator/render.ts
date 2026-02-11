import { ComponentInfo } from '../analyzer';

export function buildRenderHelper(component: ComponentInfo): string {
    const renderFn = component.usesRouter ? 'render' : 'renderWithProviders';
    const renderOptions: string[] = [];
    if (!component.usesRouter && component.usesAuthHook) {
        renderOptions.push('withAuthProvider: false');
        const authState = deriveAuthState(component.name);
        renderOptions.push(`authState: ${authState}`);
    }
    const optionsSuffix = renderOptions.length > 0 ? `, { ${renderOptions.join(', ')} }` : '';
    if (component.props.length > 0) {
        return [
            'const renderUI = (props = {}) =>',
            `  ${renderFn}(<${component.name} {...defaultProps} {...props} />${optionsSuffix});`,
        ].join('\n');
    }

    return ['const renderUI = () =>', `  ${renderFn}(<${component.name} />${optionsSuffix});`].join('\n');
}

function deriveAuthState(componentName: string): string {
    if (/PublicRoute/i.test(componentName)) {
        return '{ isAuthenticated: false, isLoading: false }';
    }
    if (/ProtectedRoute/i.test(componentName)) {
        return '{ isAuthenticated: true, isLoading: false }';
    }
    return '{ isAuthenticated: false, isLoading: false }';
}
