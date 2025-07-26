"""The ``celery result`` program, used to inspect task results."""
import click

from celery.bin.base import CeleryCommand, CeleryOption, handle_preload_options


@click.command(cls=CeleryCommand)
@click.argument('task_id')
@click.option('-t',
              '--task',
              cls=CeleryOption,
              help_group='Result Options',
              help="Name of task (if custom backend).")
@click.option('--traceback',
              cls=CeleryOption,
              is_flag=True,
              help_group='Result Options',
              help="Show traceback instead.")
@click.pass_context
@handle_preload_options
def result(ctx, task_id, task, traceback):
    """Print the return value for a given task id."""
    app = ctx.obj.app

    result_cls = app.tasks[task].AsyncResult if task else app.AsyncResult
    task_result = result_cls(task_id)
    value = task_result.traceback if traceback else task_result.get()

    # TODO: Prettify result
    ctx.obj.echo(value)
