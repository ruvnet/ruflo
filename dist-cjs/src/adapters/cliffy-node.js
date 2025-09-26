import chalk from 'chalk';
import inquirer from 'inquirer';
import Table from 'cli-table3';
export const colors = {
    green: chalk.green,
    red: chalk.red,
    yellow: chalk.yellow,
    blue: chalk.blue,
    gray: chalk.gray,
    cyan: chalk.cyan,
    magenta: chalk.magenta,
    white: chalk.white,
    black: chalk.black,
    bold: chalk.bold,
    dim: chalk.dim,
    italic: chalk.italic,
    underline: chalk.underline,
    bgRed: chalk.bgRed,
    bgGreen: chalk.bgGreen,
    bgYellow: chalk.bgYellow,
    bgBlue: chalk.bgBlue
};
export const Input = async (options)=>{
    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'value',
            message: options.message,
            default: options.default
        }
    ]);
    return answers.value;
};
export const Confirm = async (options)=>{
    const answers = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'value',
            message: options.message,
            default: options.default
        }
    ]);
    return answers.value;
};
export const Select = async (options)=>{
    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'value',
            message: options.message,
            choices: options.options.map((opt)=>({
                    name: opt.name,
                    value: opt.value
                })),
            default: options.default
        }
    ]);
    return answers.value;
};
export { Table };

//# sourceMappingURL=cliffy-node.js.map