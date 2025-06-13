const path = require('path');
const webpack = require('webpack');
const TerserPlugin = require('terser-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const isProduction = process.env.NODE_ENV === 'production';

module.exports = [
    // Extension bundle
    {
        target: 'node',
        mode: isProduction ? 'production' : 'development',
        entry: './src/extension.ts',
        output: {
            path: path.resolve(__dirname, 'out'),
            filename: 'extension.js',
            libraryTarget: 'commonjs2'
        },
        externals: {
            vscode: 'commonjs vscode'
        },
        resolve: {
            extensions: ['.ts', '.js']
        },
        module: {
            rules: [{
                test: /\.ts$/,
                exclude: /node_modules/,
                use: 'ts-loader'
            }]
        },
        optimization: {
            minimizer: isProduction ? [new TerserPlugin({
                terserOptions: {
                    keep_fnames: true
                }
            })] : []
        },
        devtool: isProduction ? false : 'source-map'
    },
    // Webview bundle
    {
        target: 'web',
        mode: isProduction ? 'production' : 'development',
        entry: './src/ui/webview/main.tsx',
        output: {
            path: path.resolve(__dirname, 'out/webview'),
            filename: 'main.js',
            clean: true
        },
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.jsx']
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    exclude: /node_modules/,
                    use: 'ts-loader'
                },
                {
                    test: /\.css$/,
                    use: [
                        isProduction ? MiniCssExtractPlugin.loader : 'style-loader',
                        'css-loader'
                    ]
                }
            ]
        },
        plugins: [
            new HtmlWebpackPlugin({
                template: './src/ui/webview/index.html',
                filename: 'index.html'
            }),
            ...(isProduction ? [
                new MiniCssExtractPlugin({
                    filename: 'style.css'
                })
            ] : [])
        ],
        optimization: {
            minimizer: isProduction ? [new TerserPlugin()] : []
        },
        devtool: isProduction ? false : 'source-map'
    }
];