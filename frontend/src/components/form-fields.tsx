"use client";
import {
  useId,
  type InputHTMLAttributes,
  type SelectHTMLAttributes,
} from "react";
import { useFormContext } from "react-hook-form";

export function FormInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const form = useFormContext();
  const id = useId();
  const field = form && props.name ? form.register(props.name) : undefined;
  const error =
    form && props.name ? form.formState.errors[props.name] : undefined;
  return (
    <>
      <input
        {...field}
        {...props}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={error ? id : props["aria-describedby"]}
        onChange={(event) => {
          field?.onChange(event);
          props.onChange?.(event);
        }}
        onBlur={(event) => {
          field?.onBlur(event);
          props.onBlur?.(event);
        }}
      />
      {error && (
        <span id={id} className="field-error" role="alert">
          {String(error.message || "Проверь поле")}
        </span>
      )}
    </>
  );
}
export function FormSelect(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const form = useFormContext();
  const id = useId();
  const field = form && props.name ? form.register(props.name) : undefined;
  const error =
    form && props.name ? form.formState.errors[props.name] : undefined;
  return (
    <>
      <select
        {...field}
        {...props}
        aria-invalid={error ? true : props["aria-invalid"]}
        aria-describedby={error ? id : props["aria-describedby"]}
        onChange={(event) => {
          field?.onChange(event);
          props.onChange?.(event);
        }}
        onBlur={(event) => {
          field?.onBlur(event);
          props.onBlur?.(event);
        }}
      />
      {error && (
        <span id={id} className="field-error" role="alert">
          {String(error.message || "Проверь поле")}
        </span>
      )}
    </>
  );
}
